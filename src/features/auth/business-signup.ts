import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, type DbLike } from "@/db/client";
import { auditLogs, authTokens, businessMembers, businessSlugHistory, businesses, resources, sessions, users } from "@/db/schema";
import { DEFAULT_POLICY, temporarySlug, type BusinessCategory } from "@/features/business/policy-defaults";
import { absoluteUrl } from "@/lib/api";
import { sendMail } from "@/lib/mail";
import { businessAppliedMail, businessOtpMail } from "@/lib/mail/templates";
import type { RequestMeta } from "@/lib/request-meta";
import { BUSINESS_SIGNUP_PER_IP_PER_HOUR, OTP_TTL_MIN, UNVERIFIED_BUSINESS_TTL_DAYS } from "./constants";
import { LOGIN_FAIL_WINDOW_MIN } from "./constants";
import { hashPassword, verifyPassword } from "./crypto";
import { HttpError } from "./errors";
import { ipBlocked, loginBackoff, recordLoginFail } from "./login-backoff";
import { issueOtp, verifyOtp } from "./tokens";

/**
 * 사업자 가입 신청 (FR-AUTH-010, 04 플로우 1).
 *
 * 순서는 04 를 따른다: 신청 → User + Business(PENDING, emailVerifiedAt=null) + BusinessMember(OWNER) + 워크인 계정 생성
 * → OTP 메일 → 검증되면 emailVerifiedAt 기록 → 콘솔 열림. 미검증 7일은 배치가 지운다 (타인 이메일·사업자번호 선점 방지).
 * 콘솔 게이트는 principal.consoleAccess 가 emailVerified 로 건다.
 *
 * 같은 이메일로 고객·사업자 둘 다 되어야 한다(사용자 결정). 계정은 하나(users.email unique) 이고 "사업자" 는 그 계정에
 * Business + OWNER 멤버십이 붙는 것이다: 기존 고객 계정으로 신청하면 비밀번호(또는 로그인 세션)로 본인을 확인하고 그 계정에 사업장을
 * 붙인다. 소셜 전용 계정(비밀번호 없음)은 로그인한 뒤 신청하면 된다. 1계정 1사업장(다중 소속은 P3)은 그대로다.
 */
export type BusinessSignupInput = {
  email: string;
  /** 새 계정이면 필수. 기존 고객 계정으로 신청하면 그 계정의 비밀번호(본인 확인) — 로그인 상태(existingUserId)면 생략 */
  password?: string;
  /** 로그인한 고객이 자기 계정으로 신청할 때 — 이메일·비밀번호 확인을 건너뛴다 */
  existingUserId?: string;
  ownerName: string;
  phone: string;
  businessName: string;
  bizRegNo: string;
  category: BusinessCategory;
  address: string;
  addressDetail?: string;
  // 사업자등록증 이미지(선택, 심사 참고용)는 저장 컬럼이 아직 없다 — 관리자 심사(FR-ADM-010) 구현 시 함께 붙인다
};

export function walkinEmail(businessId: string): string {
  return `walkin+${businessId}@internal`;
}

/**
 * 동일 IP 시간당 3건 (OTP 발급 행 수로 센다). IP 를 알 수 없으면(헤더 위조·프록시 없음) "알 수 없음" 버킷(ip IS NULL)으로
 * 같이 세어 fail-closed — 건너뛰면 헤더 한 줄로 제한이 사라진다. 신청을 지워도 발급 행은 남는다(auth_tokens.user_id nullable).
 */
async function assertIpQuota(ip: string | null): Promise<void> {
  const since = new Date(Date.now() - 3600_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authTokens)
    .where(and(eq(authTokens.kind, "EMAIL_OTP"), ip ? eq(authTokens.ip, ip) : isNull(authTokens.ip), gt(authTokens.createdAt, since)));
  if (n >= BUSINESS_SIGNUP_PER_IP_PER_HOUR) throw new HttpError(429, "RATE_LIMITED", { retryAfterSec: 3600 });
}

/**
 * 기존 계정 본인 확인 — 로그인 세션(existingUserId)이거나 그 계정의 비밀번호. 비밀번호 경로는 로그인과 **같은 백오프·IP 상한**을
 * 건다: 안 그러면 이 엔드포인트가 아무 고객 이메일에 대한 무제한 비밀번호 오라클이 된다. 실패는 LOGIN_FAIL 로 남겨 로그인과 카운터를 공유한다.
 */
async function assertIdentity(userId: string, input: BusinessSignupInput, meta: RequestMeta): Promise<void> {
  const [acct] = await db.select({ passwordHash: users.passwordHash, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  if (!acct || acct.status !== "ACTIVE") throw new HttpError(409, "EMAIL_TAKEN");
  if (input.existingUserId === userId) return;
  if (!acct.passwordHash) throw new HttpError(409, "EMAIL_TAKEN_LOGIN_REQUIRED"); // 소셜 전용 — 로그인 후 신청
  if (await ipBlocked(meta.ip)) throw new HttpError(429, "RATE_LIMITED", { retryAfterSec: LOGIN_FAIL_WINDOW_MIN * 60 });
  const backoff = await loginBackoff(input.email);
  if (backoff.blocked) throw new HttpError(429, "RATE_LIMITED", { retryAfterSec: backoff.retryAfterSec });
  if (!input.password || !(await verifyPassword(input.password, acct.passwordHash))) {
    await recordLoginFail(input.email, meta, "BAD_PASSWORD");
    throw new HttpError(401, "EMAIL_TAKEN_PASSWORD_MISMATCH");
  }
}

/**
 * "신청과 함께 만들어진 계정" 인지 "신청 전부터 있던 고객 계정" 인지 — 같은 트랜잭션에서 만들면 두 created_at 이 같은 now() 라
 * 차이가 0 이다. 1초 넘게 앞서면 기존 계정. (컬럼을 하나 더 두는 대신 이 불변식에 기댄다 — users·businesses 모두 default now())
 */
export function isPreexistingAccount(userCreatedAt: Date, businessCreatedAt: Date): boolean {
  return userCreatedAt.getTime() < businessCreatedAt.getTime() - 1000;
}

export async function applyBusiness(input: BusinessSignupInput, meta: RequestMeta): Promise<{ userId: string; businessId: string }> {
  await assertIpQuota(meta.ip);

  const [dup] = await db
    .select({ id: businesses.id, status: businesses.status, emailVerifiedAt: businesses.emailVerifiedAt })
    .from(businesses)
    .where(eq(businesses.bizRegNo, input.bizRegNo))
    .limit(1);
  const [emailOwner] = await db.select({ id: users.id, createdAt: users.createdAt }).from(users).where(eq(users.email, input.email)).limit(1);

  // 반려된 신청의 재신청 (FR-AUTH-010 예외): 같은 소유자 이메일이면 그 사업장을 PENDING 으로 되돌리고 내용을 갈아 넣는다.
  // 감사 로그(BUSINESS_REJECT)가 사업장을 참조하므로 지우지 않고 재사용한다.
  if (dup && dup.status === "REJECTED" && dup.emailVerifiedAt !== null) {
    const [owner] = await db
      .select({ userId: businessMembers.userId })
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, dup.id), eq(businessMembers.role, "OWNER")))
      .limit(1);
    if (!owner || !emailOwner || owner.userId !== emailOwner.id) throw new HttpError(409, emailOwner ? "EMAIL_TAKEN" : "BIZ_REG_NO_TAKEN");
    await assertIdentity(owner.userId, input, meta);
    await db.transaction(async (tx) => {
      // 계정 정보는 비어 있을 때만 채운다 — 고객으로 쓰던 이름을 덮어쓰지 않는다 (붙이기 경로와 같은 규칙)
      await tx.update(users).set({ phone: sql`coalesce(${users.phone}, ${input.phone})` }).where(eq(users.id, owner.userId));
      await tx
        .update(businesses)
        .set({
          name: input.businessName,
          category: input.category,
          phone: input.phone,
          address: input.address,
          addressDetail: input.addressDetail ?? null,
          status: "PENDING",
          rejectedReason: null,
          emailVerifiedAt: null,
        })
        .where(eq(businesses.id, dup.id));
    });
    await sendOtp(owner.userId, input.email, meta.ip);
    return { userId: owner.userId, businessId: dup.id };
  }

  // 미검증(삭제 대기) 신청이 같은 사업자번호·이메일을 점유 중이면 치우고 새로 시작한다. 그 외 중복은 거절
  if (dup && dup.emailVerifiedAt !== null) throw new HttpError(409, "BIZ_REG_NO_TAKEN");
  const stalePurge: string[] = [];
  /** 기존 계정에 사업장을 붙이는 경우 그 사용자 id */
  let attachTo: string | null = null;
  if (emailOwner) {
    const [m] = await db
      .select({ businessId: businessMembers.businessId, verified: businesses.emailVerifiedAt, bizCreatedAt: businesses.createdAt })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(eq(businessMembers.userId, emailOwner.id))
      .limit(1);
    if (m && m.verified !== null) throw new HttpError(409, "ALREADY_MEMBER"); // 이미 어느 사업장의 구성원 (1계정 1사업장)
    if (m && (!dup || dup.id !== m.businessId)) stalePurge.push(m.businessId); // 미검증 옛 신청은 치운다
    // 신청 전부터 있던 계정(고객)이면 본인 확인 후 그 계정에 붙인다. 미검증 신청이 이미 있어도 같다 — 계정은 그대로 두고 신청만 새로 쓴다.
    // 신청과 함께 만들어진 미검증 계정은 검증 전엔 누구의 것도 아니다(선점 방지) — 치우고 새로 만든다.
    if (!m || isPreexistingAccount(emailOwner.createdAt, m.bizCreatedAt)) {
      await assertIdentity(emailOwner.id, input, meta);
      attachTo = emailOwner.id;
    }
  } else if (input.existingUserId) {
    throw new HttpError(409, "EMAIL_MISMATCH"); // 로그인한 계정의 이메일과 다르다
  }
  if (!attachTo && !input.password) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["password"], message: "비밀번호를 입력해 주세요" }] });

  const passwordHash = attachTo ? null : await hashPassword(input.password!);

  const result = await db.transaction(async (tx) => {
    for (const id of stalePurge) await purgeBusiness(id, tx);
    if (dup) await purgeBusiness(dup.id, tx);

    let ownerId = attachTo;
    if (ownerId) {
      // 같은 계정으로 동시에 두 번 신청하면 둘 다 위 검사를 통과할 수 있다 — 계정 행을 잠그고 소속을 다시 본다 (1계정 1사업장)
      await tx.execute(sql`select 1 from ${users} where ${users.id} = ${ownerId} for update`);
      const [again] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, ownerId)).limit(1);
      if (again) throw new HttpError(409, "ALREADY_MEMBER");
    }
    if (!ownerId) {
      const [u] = await tx
        .insert(users)
        .values({ email: input.email, name: input.ownerName, phone: input.phone, passwordHash: passwordHash!, provider: "LOCAL" })
        .returning({ id: users.id });
      ownerId = u.id;
    } else {
      // 기존 계정: 이름·연락처는 비어 있을 때만 채운다 (고객이 쓰던 이름을 덮어쓰지 않는다)
      await tx.update(users).set({ phone: sql`coalesce(${users.phone}, ${input.phone})` }).where(eq(users.id, ownerId));
    }
    const u = { id: ownerId };

    let slug = temporarySlug();
    for (let i = 0; i < 3; i++) {
      const [taken] = await tx.select({ id: businessSlugHistory.id }).from(businessSlugHistory).where(eq(businessSlugHistory.slug, slug)).limit(1);
      if (!taken) break;
      slug = temporarySlug();
    }
    const [b] = await tx
      .insert(businesses)
      .values({
        slug,
        name: input.businessName,
        bizRegNo: input.bizRegNo,
        category: input.category,
        phone: input.phone,
        address: input.address,
        addressDetail: input.addressDetail ?? null,
        status: "PENDING",
        policy: DEFAULT_POLICY,
      })
      .returning({ id: businesses.id });
    await tx.insert(businessSlugHistory).values({ businessId: b.id, slug });
    await tx.insert(businessMembers).values({ userId: u.id, businessId: b.id, role: "OWNER", status: "ACTIVE", permissions: {} });
    // 워크인 대리 등록용 내부 계정 (FR-AUTH-010 · #54). 로그인 불가(비밀번호 없음), 리뷰 자격 없음
    await tx.insert(users).values({ email: walkinEmail(b.id), name: "워크인 고객", provider: "LOCAL" });

    return { userId: u.id, businessId: b.id };
  });

  await sendOtp(result.userId, input.email, meta.ip);
  return result;
}

async function sendOtp(userId: string, email: string, ip: string | null): Promise<void> {
  const code = await issueOtp(userId, ip);
  await sendMail(businessOtpMail(email, code, OTP_TTL_MIN));
}

/** OTP 재발송. 계정 존재 여부를 응답으로 구분하지 않는다 — 항상 성공처럼 답한다 */
export async function resendBusinessOtp(email: string, meta: RequestMeta): Promise<void> {
  await assertIpQuota(meta.ip); // 조회보다 먼저 — 계정이 있을 때만 429 가 나면 존재 여부 오라클이 된다
  const target = await unverifiedOwner(email);
  if (!target) return;
  await sendOtp(target.userId, email, meta.ip);
}

async function unverifiedOwner(email: string): Promise<{ userId: string; businessId: string; businessName: string } | null> {
  const [row] = await db
    .select({ userId: users.id, businessId: businesses.id, businessName: businesses.name })
    .from(users)
    .innerJoin(businessMembers, and(eq(businessMembers.userId, users.id), eq(businessMembers.role, "OWNER")))
    .innerJoin(businesses, and(eq(businesses.id, businessMembers.businessId), isNull(businesses.emailVerifiedAt)))
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

export type VerifyOutcome = { ok: true } | { ok: false; reason: "INVALID" | "EXPIRED" | "TOO_MANY" | "NONE" };

export async function verifyBusinessEmail(email: string, code: string): Promise<VerifyOutcome> {
  const target = await unverifiedOwner(email);
  if (!target) return { ok: false, reason: "NONE" };
  const r = await db.transaction(async (tx) => {
    const v = await verifyOtp(target.userId, code, tx);
    if (!v.ok) return v;
    const now = new Date();
    await tx.update(businesses).set({ emailVerifiedAt: now }).where(eq(businesses.id, target.businessId));
    await tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, target.userId));
    return v;
  });
  if (!r.ok) return r;
  // 접수 확인 메일. 관리자 알림(BUSINESS_APPLIED)은 알림 에픽(#57 이후)에서 Notification 테이블로 — 여기서는 로그만
  await sendMail(businessAppliedMail(email, target.businessName, absoluteUrl("/console"))).catch((e) => console.error("[business-signup] applied mail failed:", (e as Error).message));
  console.info(`[business-signup] applied businessId=${target.businessId}`);
  return { ok: true };
}

/**
 * 사업장과 그에 딸린 것을 지운다 — 미검증 신청 정리·재신청 전용. 검증된 사업장은 지우지 않는다(그건 FR-ADM-020 상태 전이다).
 * FK 에 CASCADE 가 없으니 자식부터: resources(초대가 만든 STAFF) → business_members → slug_history → businesses.
 * 사용자는 물리 삭제 대신 다른 곳(audit_logs.actor_id 등)이 참조할 수 있으므로: 참조가 남았으면 **익명화**(WITHDRAWN,
 * 이메일·이름 치환)하고, 참조가 없을 때만 지운다. auth_tokens 는 user_id 만 NULL 로 — IP 레이트리밋 카운터로 남긴다.
 */
export async function purgeBusiness(businessId: string, tx: DbLike = db): Promise<void> {
  const members = await tx.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, businessId));
  const userIds = members.map((m) => m.userId);
  const [walkin] = await tx.select({ id: users.id }).from(users).where(eq(users.email, walkinEmail(businessId))).limit(1);
  if (walkin) userIds.push(walkin.id);
  const [biz] = await tx.select({ createdAt: businesses.createdAt }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const bizCreatedAt = biz?.createdAt ?? null;

  await tx.delete(resources).where(eq(resources.businessId, businessId));
  await tx.delete(businessMembers).where(eq(businessMembers.businessId, businessId));
  await tx.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, businessId));
  await tx.delete(businesses).where(eq(businesses.id, businessId));
  for (const uid of userIds) {
    // 다른 사업장에도 속한 사용자는 남긴다 (이 흐름에서는 생기지 않지만 방어)
    const [other] = await tx.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, uid)).limit(1);
    if (other) continue;
    // 신청 이전부터 있던 계정(기존 고객이 사업장을 붙인 경우)은 지우지 않는다 — 신청과 함께 만들어진 계정만 정리 대상 (isPreexistingAccount)
    const [u] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, uid)).limit(1);
    if (u && bizCreatedAt && isPreexistingAccount(u.createdAt, bizCreatedAt)) continue;
    await tx.update(authTokens).set({ userId: null, usedAt: sql`coalesce(${authTokens.usedAt}, now())` }).where(eq(authTokens.userId, uid));
    await tx.delete(sessions).where(eq(sessions.userId, uid));
    const [ref] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.actorId, uid)).limit(1);
    if (ref) {
      await tx
        .update(users)
        .set({ email: `deleted+${uid}@internal`, name: "삭제된 계정", phone: null, passwordHash: null, providerAccountId: null, totpSecretEnc: null, status: "WITHDRAWN" })
        .where(eq(users.id, uid));
    } else {
      await tx.delete(users).where(eq(users.id, uid));
    }
  }
}

/** 배치: emailVerifiedAt IS NULL 이고 7일 지난 신청 삭제. 한 건이 실패해도 나머지는 계속한다. 지운 수를 돌려준다 */
export async function cleanupUnverifiedBusinesses(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_BUSINESS_TTL_DAYS * 86400_000);
  const stale = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(isNull(businesses.emailVerifiedAt), lt(businesses.createdAt, cutoff)));
  let deleted = 0;
  for (const b of stale) {
    try {
      await db.transaction((tx) => purgeBusiness(b.id, tx));
      deleted++;
    } catch (e) {
      // 한 건의 FK 잔여 참조가 배치 전체를 영구 정지시키면 안 된다 — 기록하고 다음으로
      console.error(`[cleanup-unverified] businessId=${b.id} 삭제 실패:`, (e as Error).message);
    }
  }
  return deleted;
}
