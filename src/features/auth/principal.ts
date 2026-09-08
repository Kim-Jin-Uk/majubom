import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { businessMembers, businesses, users, type MemberPermissions } from "@/db/schema";

/**
 * Principal — JWT 에 싣는 "누구인가" 스냅샷. 15분마다(액세스 갱신) 또는 콘솔 매 요청(프록시) 다시 읽는다.
 * 여기 없는 것은 JWT 에도 없다. 연락처·이메일은 싣지 않는다 (쿠키는 로그·프록시에 남는다).
 */
export type Membership = {
  memberId: string;
  businessId: string;
  businessSlug: string;
  businessStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "BLOCKED";
  role: "OWNER" | "MANAGER";
  memberStatus: "INVITED" | "ACTIVE" | "INACTIVE";
  permissions: MemberPermissions;
};

export type Principal = {
  uid: string;
  name: string;
  globalRole: "ADMIN" | "USER";
  userStatus: "ACTIVE" | "SUSPENDED" | "WITHDRAWN";
  totpEnabled: boolean;
  /** 1계정 1사업장 (다중 소속은 P3). 소속이 없으면 null */
  membership: Membership | null;
};

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      globalRole: users.globalRole,
      status: users.status,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;

  const [m] = await db
    .select({
      memberId: businessMembers.id,
      role: businessMembers.role,
      memberStatus: businessMembers.status,
      permissions: businessMembers.permissions,
      businessId: businesses.id,
      businessSlug: businesses.slug,
      businessStatus: businesses.status,
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.userId, userId)))
    .orderBy(businessMembers.createdAt)
    .limit(1);

  return {
    uid: u.id,
    name: u.name,
    globalRole: u.globalRole,
    userStatus: u.status,
    totpEnabled: u.totpEnabledAt !== null,
    membership: m
      ? {
          memberId: m.memberId,
          businessId: m.businessId,
          businessSlug: m.businessSlug,
          businessStatus: m.businessStatus,
          role: m.role,
          memberStatus: m.memberStatus,
          permissions: m.permissions ?? {},
        }
      : null,
  };
}

export type AccessDenial = "USER_INACTIVE" | "MEMBER_INACTIVE" | "BUSINESS_BLOCKED" | "NO_MEMBERSHIP";

/**
 * 로그인 자체를 막아야 하는 상태. WITHDRAWN 은 탈퇴, SUSPENDED 는 관리자 정지 (FR-ADM · FR-AUTH-030 무효화 표).
 */
export function userLoginDenial(p: Pick<Principal, "userStatus">): AccessDenial | null {
  return p.userStatus === "ACTIVE" ? null : "USER_INACTIVE";
}

/**
 * 콘솔 접근 판정 (FR-ADM-020).
 * - BLOCKED 사업장: 콘솔 전면 차단
 * - SUSPENDED: 읽기 전용 + 예약 취소·상담 허용 — 여기서는 통과시키고 `readOnly` 로 표시한다. 쓰기 API 가 각자 거부한다
 * - PENDING / REJECTED: 콘솔은 열린다 (FR-AUTH-010 — 승인은 공개 URL 게이트일 뿐)
 * - 멤버 INVITED(수락 전)·INACTIVE: 차단
 */
export function consoleAccess(p: Principal): { denial: AccessDenial | null; readOnly: boolean } {
  const userDenial = userLoginDenial(p);
  if (userDenial) return { denial: userDenial, readOnly: false };
  const m = p.membership;
  if (!m) return { denial: "NO_MEMBERSHIP", readOnly: false };
  if (m.memberStatus !== "ACTIVE") return { denial: "MEMBER_INACTIVE", readOnly: false };
  if (m.businessStatus === "BLOCKED") return { denial: "BUSINESS_BLOCKED", readOnly: false };
  return { denial: null, readOnly: m.businessStatus === "SUSPENDED" };
}

/** 두 스냅샷이 같은가 — 프록시가 JWT 를 다시 써야 하는지 판단 */
export function principalEquals(a: Principal, b: Principal): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
