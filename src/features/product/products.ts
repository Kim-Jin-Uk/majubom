import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, type DbLike } from "@/db/client";
import { businesses, productResources, products, reservations, resources, type FixedStartTime, type OpeningHour } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { toMin } from "@/features/business/hours";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { normalizeFixedStartTimes, type ProductInput, type ProductLimitedInput } from "./schema";

/**
 * 예약 상품 (FR-PRD-010~030, 에픽 #31).
 *
 * 입력 모양은 schema.ts 가, 여기서는 **다른 데이터에 기대는 규칙**을 본다:
 * - 담당 자원은 우리 사업장의 활성 자원이어야 하고 STAFF 와 SHARED 를 섞을 수 없다 (복수 자원 동시 점유는 P2)
 * - capacityPerSlot 은 연결 자원 정원의 최솟값 이하 — 조용히 줄이지 않고 400 으로 거부한다 (15명 수업을 등록했다고 믿는데 1명만 받는 사고 방지)
 * - 소요 시간이 가장 긴 영업일의 영업 구간보다 길면 거부
 * - 고정 회차가 영업시간(브레이크 무시) 밖이면 저장은 하되 warnings 로 알린다 — 조용히 사라지면 사업자가 이유를 모른다
 * - 예약 형태가 바뀌는 수정은 미래 예약 수를 알려주고 확인을 받는다. 기존 예약의 스냅샷(occupy·duration·버퍼)은 건드리지 않는다
 */
export type ProductWarning = { dow: number; time: string; reason: "CLOSED_DAY" | "OUTSIDE_HOURS" };

export type ProductListItem = {
  id: string;
  name: string;
  image: string | null;
  startMode: "FREE" | "FIXED";
  durationMin: number;
  durationOptions: number[] | null;
  capacityPerSlot: number;
  maxPartySize: number;
  priceDisplay: string | null;
  status: "DRAFT" | "ACTIVE" | "HIDDEN" | "ARCHIVED";
  sortOrder: number;
  resources: Array<{ id: string; name: string; type: "STAFF" | "SPACE" | "SHARED"; isActive: boolean }>;
};

export type ProductDetail = ProductListItem & {
  description: string | null;
  images: string[];
  slotIntervalMin: number | null;
  fixedStartTimes: FixedStartTime[] | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  resourceSelectMode: "REQUIRED" | "OPTIONAL" | "AUTO" | "NONE";
  resourceIds: string[];
  /** 미래 REQUESTED/CONFIRMED 예약 수 — 수정 화면의 경고에 쓴다 */
  futureReservations: number;
  /** 현재 영업시간 기준으로 예약 페이지에 표시되지 않는 고정 회차 */
  warnings: ProductWarning[];
};

async function resourcesOf(productIds: string[], q: DbLike = db) {
  if (productIds.length === 0) return new Map<string, ProductListItem["resources"]>();
  const rows = await q
    .select({ productId: productResources.productId, id: resources.id, name: resources.name, type: resources.type, isActive: resources.isActive, sortOrder: resources.sortOrder })
    .from(productResources)
    .innerJoin(resources, eq(resources.id, productResources.resourceId))
    .where(inArray(productResources.productId, productIds))
    .orderBy(asc(resources.sortOrder));
  const map = new Map<string, ProductListItem["resources"]>();
  for (const r of rows) {
    const list = map.get(r.productId) ?? [];
    list.push({ id: r.id, name: r.name, type: r.type, isActive: r.isActive });
    map.set(r.productId, list);
  }
  return map;
}

/** ARCHIVED 는 목록에서 숨긴다 (FR-PRD-030). includeArchived 는 관리자·이력용 */
export async function listProducts(businessId: string, opts: { includeArchived?: boolean } = {}): Promise<ProductListItem[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      images: products.images,
      startMode: products.startMode,
      durationMin: products.durationMin,
      durationOptions: products.durationOptions,
      capacityPerSlot: products.capacityPerSlot,
      maxPartySize: products.maxPartySize,
      priceDisplay: products.priceDisplay,
      status: products.status,
      sortOrder: products.sortOrder,
    })
    .from(products)
    .where(and(eq(products.businessId, businessId), opts.includeArchived ? undefined : ne(products.status, "ARCHIVED")))
    .orderBy(asc(products.sortOrder), asc(products.createdAt));
  const res = await resourcesOf(rows.map((r) => r.id));
  return rows.map(({ images, ...r }) => ({ ...r, image: images[0] ?? null, resources: res.get(r.id) ?? [] }));
}

export async function getProduct(businessId: string, productId: string): Promise<ProductDetail> {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.businessId, businessId)))
    .limit(1);
  if (!p) throw new HttpError(404, "NOT_FOUND");
  const res = (await resourcesOf([p.id])).get(p.id) ?? [];
  const [b] = await db.select({ openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return {
    warnings: p.startMode === "FIXED" && p.fixedStartTimes ? fixedTimeWarnings(p.fixedStartTimes, b?.openingHours ?? [], p.durationMin) : [],
    id: p.id,
    name: p.name,
    description: p.description,
    images: p.images,
    image: p.images[0] ?? null,
    startMode: p.startMode,
    slotIntervalMin: p.slotIntervalMin,
    fixedStartTimes: p.fixedStartTimes,
    durationMin: p.durationMin,
    durationOptions: p.durationOptions,
    bufferBeforeMin: p.bufferBeforeMin,
    bufferAfterMin: p.bufferAfterMin,
    capacityPerSlot: p.capacityPerSlot,
    maxPartySize: p.maxPartySize,
    priceDisplay: p.priceDisplay,
    resourceSelectMode: p.resourceSelectMode,
    status: p.status,
    sortOrder: p.sortOrder,
    resources: res,
    resourceIds: res.map((r) => r.id),
    futureReservations: await futureReservationCount(p.id),
  };
}

/** 미래의 REQUESTED/CONFIRMED 예약 수 (상품 기준) */
export async function futureReservationCount(productId: string, q: DbLike = db): Promise<number> {
  const [{ n }] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.productId, productId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gt(reservations.startAt, new Date())));
  return n;
}

/** 가장 긴 영업일의 영업 구간(분). 익일 마감은 close+24h. 영업시간이 없으면 null (검사를 건너뛴다 — 1단계 전일 수 있다) */
export function longestOpenSpanMin(hours: OpeningHour[]): number | null {
  if (hours.length === 0) return null;
  return Math.max(
    ...hours.map((h) => {
      const o = toMin(h.open);
      let c = toMin(h.close);
      if (c <= o) c += 24 * 60;
      return c - o;
    }),
  );
}

/**
 * 고정 회차가 영업시간 안에 드는지 — 각 회차가 [t, t+duration) 전체로 그 요일의 영업 구간 안이어야 한다(시작 시각만 보지 않는다).
 * 브레이크는 차감하지 않는다 (fixedIgnoreBreaks 기본 true: 요가원의 점심 브레이크는 접수 데스크 휴게이지 수업 금지 시간이 아니다).
 * 밖이면 저장은 허용하고 warnings 로 돌려준다 — 화면이 "이 회차는 예약 페이지에 표시되지 않습니다" 로 알린다.
 */
export function fixedTimeWarnings(days: FixedStartTime[], hours: OpeningHour[], durationMin: number): ProductWarning[] {
  const out: ProductWarning[] = [];
  for (const d of days) {
    const h = hours.find((x) => x.dow === d.dow);
    for (const t of d.times) {
      if (!h) {
        out.push({ dow: d.dow, time: t, reason: "CLOSED_DAY" });
        continue;
      }
      const o = toMin(h.open);
      let c = toMin(h.close);
      if (c <= o) c += 24 * 60;
      let s = toMin(t);
      if (s < o) s += 24 * 60; // 심야 영업의 자정 넘긴 회차
      if (s < o || s + durationMin > c) out.push({ dow: d.dow, time: t, reason: "OUTSIDE_HOURS" });
    }
  }
  return out;
}

type Checked = { resourceRows: Array<{ id: string; type: "STAFF" | "SPACE" | "SHARED"; capacity: number; isActive: boolean }>; warnings: ProductWarning[]; fixed: FixedStartTime[] | null };

/** 자원·영업시간에 기대는 검증. 실패는 400 INVALID_BODY + issues (폼이 필드에 붙인다) */
async function checkAgainstBusiness(businessId: string, input: ProductInput, q: DbLike = db): Promise<Checked> {
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  const ids = [...new Set(input.resourceIds)];
  const resourceRows = await q
    .select({ id: resources.id, type: resources.type, capacity: resources.capacity, isActive: resources.isActive })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), inArray(resources.id, ids)));
  if (resourceRows.length !== ids.length) issues.push({ path: ["resourceIds"], message: "찾을 수 없는 자원이 있습니다. 새로 고친 뒤 다시 골라 주세요" });
  if (resourceRows.some((r) => !r.isActive)) issues.push({ path: ["resourceIds"], message: "비활성 자원은 상품에 연결할 수 없습니다" });
  const types = new Set(resourceRows.map((r) => r.type));
  if (types.has("STAFF") && types.has("SHARED")) issues.push({ path: ["resourceIds"], message: "담당자(STAFF)와 공용(SHARED) 자원은 한 상품에 섞을 수 없습니다" });
  const minCap = resourceRows.length ? Math.min(...resourceRows.map((r) => r.capacity)) : null;
  if (minCap !== null && input.capacityPerSlot > minCap) issues.push({ path: ["capacityPerSlot"], message: `슬롯당 정원은 연결한 자원의 정원(${minCap}명) 이하여야 합니다` });

  const [b] = await q.select({ openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  const span = longestOpenSpanMin(b.openingHours);
  if (span !== null && input.durationMin > span) issues.push({ path: ["durationMin"], message: `소요 시간이 영업시간(최대 ${span}분)보다 깁니다` });
  if (issues.length) throw new HttpError(400, "INVALID_BODY", { issues, fields: [...new Set(issues.map((i) => String(i.path[0])))] });

  const fixed = input.startMode === "FIXED" ? normalizeFixedStartTimes(input.fixedStartTimes ?? []) : null;
  const warnings = fixed ? fixedTimeWarnings(fixed, b.openingHours, input.durationMin) : [];
  return { resourceRows, warnings, fixed };
}

function columnsOf(input: ProductInput, fixed: FixedStartTime[] | null) {
  const free = input.startMode === "FREE";
  return {
    name: input.name,
    description: input.description ?? null,
    images: input.images,
    startMode: input.startMode,
    slotIntervalMin: free ? input.slotIntervalMin! : null,
    fixedStartTimes: free ? null : fixed,
    durationMin: input.durationMin,
    durationOptions: free && input.durationOptions && input.durationOptions.length > 0 ? [...input.durationOptions].sort((a, b) => a - b) : null,
    bufferBeforeMin: input.bufferBeforeMin,
    bufferAfterMin: input.bufferAfterMin,
    capacityPerSlot: input.capacityPerSlot,
    maxPartySize: input.maxPartySize,
    priceDisplay: input.priceDisplay || null,
    resourceSelectMode: input.resourceSelectMode,
    status: input.status,
  };
}

export async function createProduct(businessId: string, input: ProductInput): Promise<{ id: string; warnings: ProductWarning[] }> {
  const { warnings, fixed } = await checkAgainstBusiness(businessId, input);
  const id = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        businessId,
        ...columnsOf(input, fixed),
        sortOrder: sql`(select coalesce(max(p2.sort_order), -1) + 1 from products p2 where p2.business_id = ${businessId})`,
      })
      .returning({ id: products.id });
    await tx.insert(productResources).values([...new Set(input.resourceIds)].map((rid) => ({ productId: p.id, resourceId: rid })));
    return p.id;
  });
  return { id, warnings };
}

/** 예약 형태에 영향을 주는 필드 (FR-PRD-020) */
const SHAPE_KEYS = ["startMode", "fixedStartTimes", "slotIntervalMin", "durationMin", "durationOptions", "bufferBeforeMin", "bufferAfterMin", "capacityPerSlot"] as const;

export type UpdateResult = { ok: true; warnings: ProductWarning[]; affected: number };

/**
 * OWNER 의 전체 수정. 예약 형태가 바뀌고 미래 예약이 있으면 confirmAffected 없이는 409 AFFECTS_RESERVATIONS { count } —
 * 화면이 "기존 예약 N건은 예약 당시 설정을 유지합니다" 로 확인을 받는다. 거부(400): 정원을 미래 회차의 최대 점유보다 낮게 / 미래 예약이 있는 자원 해제.
 */
export async function updateProduct(businessId: string, productId: string, input: ProductInput): Promise<UpdateResult> {
  const { warnings, fixed } = await checkAgainstBusiness(businessId, input);
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.businessId, businessId)))
      .limit(1)
      .for("update");
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    if (cur.status === "ARCHIVED") throw new HttpError(409, "ARCHIVED");
    const next = columnsOf(input, fixed);
    const curRes = (await tx.select({ id: productResources.resourceId }).from(productResources).where(eq(productResources.productId, productId))).map((r) => r.id);
    const nextRes = [...new Set(input.resourceIds)];
    const removed = curRes.filter((id) => !nextRes.includes(id));
    const added = nextRes.filter((id) => !curRes.includes(id));
    const shapeChanged = SHAPE_KEYS.some((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k])) || removed.length > 0 || added.length > 0;

    let affected = 0;
    if (shapeChanged) {
      affected = await futureReservationCount(productId, tx);
      if (affected > 0) {
        // 정원을 미래 회차 중 최대 점유 인원보다 낮게 내리는 것은 거부 — 이미 받은 손님을 앉힐 자리가 없어진다
        if (next.capacityPerSlot < cur.capacityPerSlot) {
          const [{ maxBooked }] = await tx
            .select({ maxBooked: sql<number>`coalesce(max(s), 0)::int` })
            .from(
              sql`(select sum(${reservations.partySize}) as s from ${reservations} where ${reservations.productId} = ${productId} and ${reservations.status} in ('REQUESTED','CONFIRMED') and ${reservations.startAt} > now() group by ${reservations.startAt}) t`,
            );
          if (next.capacityPerSlot < maxBooked) {
            throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["capacityPerSlot"], message: `미래 회차에 이미 ${maxBooked}명이 예약돼 있어 그보다 낮출 수 없습니다` }], fields: ["capacityPerSlot"], maxBooked });
          }
        }
        // 미래 예약이 있는 자원은 해제 불가 — 먼저 이관·취소해야 한다
        if (removed.length > 0) {
          const busy = await tx
            .selectDistinct({ id: reservations.resourceId })
            .from(reservations)
            .where(and(eq(reservations.productId, productId), inArray(reservations.resourceId, removed), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gt(reservations.startAt, new Date())));
          if (busy.length > 0) {
            throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["resourceIds"], message: "미래 예약이 있는 자원은 연결을 해제할 수 없습니다. 예약을 먼저 이관하거나 취소해 주세요" }], fields: ["resourceIds"], resourceIds: busy.map((b) => b.id) });
          }
        }
        if (!input.confirmAffected) throw new HttpError(409, "AFFECTS_RESERVATIONS", { count: affected });
      }
    }

    await tx.update(products).set(next).where(eq(products.id, productId));
    if (removed.length) await tx.delete(productResources).where(and(eq(productResources.productId, productId), inArray(productResources.resourceId, removed)));
    if (added.length) await tx.insert(productResources).values(added.map((rid) => ({ productId, resourceId: rid })));
    return { ok: true, warnings, affected };
  });
}

/** 매니저가 이 상품의 담당 자원(자기 계정이 연결된 STAFF)인가 */
export async function isAssignedManager(productId: string, memberId: string, q: DbLike = db): Promise<boolean> {
  const [row] = await q
    .select({ id: resources.id })
    .from(productResources)
    .innerJoin(resources, eq(resources.id, productResources.resourceId))
    .where(and(eq(productResources.productId, productId), eq(resources.memberId, memberId)))
    .limit(1);
  return Boolean(row);
}

/** MANAGER(editProduct) 의 제한 수정 — 설명·사진·ACTIVE↔HIDDEN 만, 본인이 담당 자원인 상품만 (FR-PRD-020) */
export async function updateProductLimited(businessId: string, productId: string, input: ProductLimitedInput, memberId: string): Promise<void> {
  const [cur] = await db.select({ id: products.id, status: products.status }).from(products).where(and(eq(products.id, productId), eq(products.businessId, businessId))).limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  if (!(await isAssignedManager(productId, memberId))) throw new HttpError(403, "NOT_ASSIGNED");
  if (input.status && cur.status !== "ACTIVE" && cur.status !== "HIDDEN") throw new HttpError(409, "STATUS_NOT_TOGGLEABLE"); // DRAFT 공개·ARCHIVED 복구는 OWNER 만
  await db
    .update(products)
    .set({ ...(input.description !== undefined ? { description: input.description ?? null } : {}), ...(input.images !== undefined ? { images: input.images } : {}), ...(input.status ? { status: input.status } : {}) })
    .where(eq(products.id, productId));
}

export async function setProductStatus(businessId: string, productId: string, status: "DRAFT" | "ACTIVE" | "HIDDEN"): Promise<void> {
  const rows = await db
    .update(products)
    .set({ status })
    .where(and(eq(products.id, productId), eq(products.businessId, businessId), ne(products.status, "ARCHIVED")))
    .returning({ id: products.id });
  if (rows.length !== 1) throw new HttpError(404, "NOT_FOUND");
}

export type RemoveProductResult = { ok: true; mode: "DELETED" | "ARCHIVED"; futureReservations: number };

/**
 * 삭제 (FR-PRD-030): 예약 이력이 하나라도 있으면 ARCHIVED(소프트) — 과거 예약·리뷰의 참조를 지킨다. 미래 예약이 있어도 ARCHIVED 만 (새 예약은 막히고 기존은 유지).
 * 예약이 전혀 없는 상품은 물리 삭제 (공개된 적 없는 초안 정리). 어느 쪽이든 PRODUCT_DELETE 감사.
 */
export async function removeProduct(businessId: string, productId: string, actor: { uid: string; role: "OWNER" | "MANAGER" }, meta: RequestMeta): Promise<RemoveProductResult> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select({ id: products.id, name: products.name, status: products.status }).from(products).where(and(eq(products.id, productId), eq(products.businessId, businessId))).limit(1).for("update");
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    const [{ any }] = await tx.select({ any: sql<number>`count(*)::int` }).from(reservations).where(eq(reservations.productId, productId));
    const future = await futureReservationCount(productId, tx);
    let mode: RemoveProductResult["mode"];
    if (any === 0) {
      await tx.delete(productResources).where(eq(productResources.productId, productId));
      await tx.delete(products).where(eq(products.id, productId));
      mode = "DELETED";
    } else {
      await tx.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, productId));
      mode = "ARCHIVED";
    }
    await writeAudit({ action: "PRODUCT_DELETE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "PRODUCT", targetId: productId, diff: { status: { from: cur.status, to: mode }, name: cur.name, futureReservations: future }, meta }, tx);
    return { ok: true, mode, futureReservations: future };
  });
}

export async function reorderProducts(businessId: string, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) await tx.update(products).set({ sortOrder: i }).where(and(eq(products.id, ids[i]), eq(products.businessId, businessId)));
  });
}
