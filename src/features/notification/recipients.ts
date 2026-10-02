import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { businessMembers, resources } from "@/db/schema";

/**
 * 누구에게 보낼지 (FR-NOTI-010, #96). 명세의 "수신자" 칸을 코드로 옮긴 것.
 *
 * **비활성 구성원은 뺀다.** 그만둔 매니저에게 계속 알림이 가면 그 자체가 개인정보 유출이다
 * (남의 가게 손님 이름이 계속 도착한다).
 */
export type Recipient = { userId: string; role: "OWNER" | "MANAGER" };

/** 그 사업장의 사장님들 (보통 한 명) */
export async function ownersOf(businessId: string): Promise<Recipient[]> {
  const rows = await db
    .select({ userId: businessMembers.userId, role: businessMembers.role })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, "OWNER"), eq(businessMembers.status, "ACTIVE")));
  return rows.map((r) => ({ userId: r.userId, role: r.role }));
}

/**
 * 예약을 처리할 사람들 — **담당 매니저 + 사장님**.
 *
 * 담당자가 없는 예약(공간형·자동 배정)도 있다. 그때 사장님만 남는 것이 맞다 —
 * 매니저 전원에게 뿌리면 "내 일이 아닌 알림" 이 쌓여 아무도 안 읽게 된다.
 * 담당 매니저가 곧 사장님이면 한 번만 보낸다(중복 제거).
 */
export async function reservationHandlers(businessId: string, resourceId: string | null): Promise<Recipient[]> {
  const owners = await ownersOf(businessId);
  if (!resourceId) return owners;

  const [staff] = await db
    .select({ userId: businessMembers.userId, role: businessMembers.role })
    .from(resources)
    .innerJoin(businessMembers, eq(businessMembers.id, resources.memberId))
    .where(and(eq(resources.id, resourceId), isNotNull(resources.memberId), eq(businessMembers.status, "ACTIVE")))
    .limit(1);
  if (!staff) return owners;

  const seen = new Set(owners.map((o) => o.userId));
  return seen.has(staff.userId) ? owners : [...owners, { userId: staff.userId, role: staff.role }];
}

/** 그 사업장의 활성 매니저 전원 (당일 요약처럼 담당과 무관한 알림) */
export async function managersOf(businessId: string): Promise<Recipient[]> {
  const rows = await db
    .select({ userId: businessMembers.userId, role: businessMembers.role })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, businessId), ne(businessMembers.role, "OWNER"), eq(businessMembers.status, "ACTIVE")));
  return rows.map((r) => ({ userId: r.userId, role: r.role }));
}
