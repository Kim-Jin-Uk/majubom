import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businessMembers, productResources, reservations, resources, users } from "@/db/schema";
import { HttpError, pgCode } from "@/features/auth/errors";

/**
 * 자원 관리 (FR-RES-010, #28). 자원 타입(STAFF/SPACE/SHARED)과 상품 유형(담당자형/공간형/수업형)은 다른 말이다 —
 * 자원은 "예약이 점유하는 것", 상품 유형은 "시작 시각·이용 시간·정원 세 스위치의 조합" 이다.
 *
 * - 정원(capacity)은 타입과 무관하게 1 이상. 그룹 레슨 강사(STAFF, 15)·4인 스튜디오(SPACE, 4) 가 정상 조합
 * - STAFF 는 계정 없이 이름만 등록할 수 있다(memberId null). 계정 연결은 매니저 초대(members.ts) 가 이름으로 자동 매칭하거나 resourceId 로 지정
 * - 삭제: 미래 확정·대기 예약이 있으면 불가 → 비활성화만. 비활성 자원은 신규 예약 대상에서 빠지고 기존 예약은 유지
 * - 사업자 본인도 STAFF 자원으로 등록할 수 있다 (1인 사업장) — memberId 에 OWNER 의 memberId
 */
export const resourceInputSchema = z.object({
  type: z.enum(["STAFF", "SPACE", "SHARED"]),
  name: z.string().trim().min(1, "이름을 입력해 주세요").max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  /** 생략(undefined)하면 기존 값 유지, null 이면 제거. http(s) 만 */
  imageUrl: z.url({ protocol: /^https?$/ }).max(2000).optional().nullable(),
  capacity: z.number().int().min(1, "정원은 1 이상").max(500),
  /** STAFF 만: 연결할 구성원(business_members.id). 없으면 계정 없는 담당자 */
  memberId: z.uuid().optional().nullable(),
});
export type ResourceInput = z.infer<typeof resourceInputSchema>;

export type ResourceItem = {
  id: string;
  type: "STAFF" | "SPACE" | "SHARED";
  name: string;
  description: string | null;
  imageUrl: string | null;
  capacity: number;
  isActive: boolean;
  sortOrder: number;
  memberId: string | null;
  /** 연결된 계정의 이름·상태 (STAFF) */
  member: { name: string; status: "INVITED" | "ACTIVE" | "INACTIVE"; role: "OWNER" | "MANAGER" } | null;
};

export async function listResources(businessId: string): Promise<ResourceItem[]> {
  const rows = await db
    .select({
      id: resources.id,
      type: resources.type,
      name: resources.name,
      description: resources.description,
      imageUrl: resources.imageUrl,
      capacity: resources.capacity,
      isActive: resources.isActive,
      sortOrder: resources.sortOrder,
      memberId: resources.memberId,
      memberName: users.name,
      memberStatus: businessMembers.status,
      memberRole: businessMembers.role,
    })
    .from(resources)
    .leftJoin(businessMembers, eq(businessMembers.id, resources.memberId))
    .leftJoin(users, eq(users.id, businessMembers.userId))
    .where(eq(resources.businessId, businessId))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    imageUrl: r.imageUrl,
    capacity: r.capacity,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    memberId: r.memberId,
    member: r.memberId && r.memberName && r.memberStatus && r.memberRole ? { name: r.memberName, status: r.memberStatus, role: r.memberRole } : null,
  }));
}

/** memberId 가 오면 우리 사업장 구성원이어야 하고(아니면 404), 다른 자원에 이미 연결돼 있으면 409 */
async function assertMemberLinkable(businessId: string, memberId: string, exceptResourceId?: string) {
  const [m] = await db.select({ id: businessMembers.id }).from(businessMembers).where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, businessId))).limit(1);
  if (!m) throw new HttpError(404, "NOT_FOUND");
  const [linked] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.memberId, memberId), exceptResourceId ? sql`${resources.id} <> ${exceptResourceId}` : undefined))
    .limit(1);
  if (linked) throw new HttpError(409, "MEMBER_ALREADY_LINKED");
}

export async function createResource(businessId: string, input: ResourceInput): Promise<{ id: string }> {
  const memberId = input.type === "STAFF" ? (input.memberId ?? null) : null;
  if (memberId) await assertMemberLinkable(businessId, memberId);
  const [r] = await db
    .insert(resources)
    .values({
      businessId,
      type: input.type,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      capacity: input.capacity,
      memberId,
      // max+1 을 같은 문장에서 — READ COMMITTED 에서 동시 등록은 같은 순번을 받을 수 있지만 정렬은 created_at 이 2차 키라 무해하다
      sortOrder: sql`(select coalesce(max(r2.sort_order), -1) + 1 from resources r2 where r2.business_id = ${businessId})`,
    })
    .returning({ id: resources.id });
  return { id: r.id };
}

export async function updateResource(businessId: string, resourceId: string, input: ResourceInput): Promise<void> {
  const [cur] = await db.select({ id: resources.id, type: resources.type }).from(resources).where(and(eq(resources.id, resourceId), eq(resources.businessId, businessId))).limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  const memberId = input.type === "STAFF" ? (input.memberId ?? null) : null;
  if (memberId) await assertMemberLinkable(businessId, memberId, resourceId);
  await db
    .update(resources)
    .set({ type: input.type, name: input.name, description: input.description ?? null, imageUrl: input.imageUrl, capacity: input.capacity, memberId })
    .where(and(eq(resources.id, resourceId), eq(resources.businessId, businessId)));
}

/** 미래의 REQUESTED/CONFIRMED 예약 수 — 삭제 가능 여부의 기준 */
async function futureActiveReservations(resourceId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.resourceId, resourceId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gt(reservations.startAt, new Date())));
  return n;
}

export type RemoveResult = { ok: true; mode: "DELETED" | "DEACTIVATED"; futureReservations?: number };

/**
 * 삭제 요청: 예약 이력이 전혀 없으면 물리 삭제, 미래 예약이 있으면 비활성화만(409 가 아니라 결과로 알린다),
 * 과거 예약만 있으면 비활성화(이력 보존). 상품 연결(product_resources)이 있으면 삭제하지 않고 비활성화.
 */
export async function removeResource(businessId: string, resourceId: string): Promise<RemoveResult> {
  const [cur] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), eq(resources.businessId, businessId))).limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  const future = await futureActiveReservations(resourceId);
  const [{ any }] = await db.select({ any: sql<number>`count(*)::int` }).from(reservations).where(eq(reservations.resourceId, resourceId));
  const [{ linked }] = await db.select({ linked: sql<number>`count(*)::int` }).from(productResources).where(eq(productResources.resourceId, resourceId));
  const scope = and(eq(resources.id, resourceId), eq(resources.businessId, businessId));
  if (any === 0 && linked === 0) {
    // 근무표·휴무 등 다른 참조가 남아 있거나 세는 사이 예약이 생겼으면 FK(23503) — 삭제 대신 비활성화로 떨어진다
    try {
      await db.delete(resources).where(scope);
      return { ok: true, mode: "DELETED" };
    } catch (e) {
      if (pgCode(e) !== "23503") throw e;
    }
  }
  await db.update(resources).set({ isActive: false }).where(scope);
  return { ok: true, mode: "DEACTIVATED", futureReservations: future };
}

export async function setResourceActive(businessId: string, resourceId: string, isActive: boolean): Promise<void> {
  const rows = await db.update(resources).set({ isActive }).where(and(eq(resources.id, resourceId), eq(resources.businessId, businessId))).returning({ id: resources.id });
  if (rows.length !== 1) throw new HttpError(404, "NOT_FOUND");
}

/** 정렬: id 배열 순서대로 sort_order 부여 (우리 사업장 것만) */
export async function reorderResources(businessId: string, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.update(resources).set({ sortOrder: i }).where(and(eq(resources.id, ids[i]), eq(resources.businessId, businessId)));
    }
  });
}

/** 계정과 연결되지 않은 STAFF 자원 — 매니저 초대 시 "이 담당자에게 계정 부여" 후보 */
export async function unlinkedStaffResources(businessId: string): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.type, "STAFF"), isNull(resources.memberId), eq(resources.isActive, true)))
    .orderBy(asc(resources.sortOrder));
}
