import { and, eq } from "drizzle-orm";
import type { Account, Profile } from "next-auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { PendingProfile } from "./types";

export type OAuthProvider = "KAKAO" | "GOOGLE";

export type OAuthIdentity = {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string | null;
  /** 제공자가 "검증된 이메일" 이라고 보증하는가. 카카오는 is_email_verified, 구글은 email_verified */
  emailVerified: boolean;
  name: string | null;
};

/** Auth.js 의 account/profile 을 우리 표현으로. 지원하지 않는 프로바이더는 null */
export function readIdentity(account: Account, profile: Profile | undefined): OAuthIdentity | null {
  const provider = account.provider === "kakao" ? "KAKAO" : account.provider === "google" ? "GOOGLE" : null;
  if (!provider) return null;
  const p = (profile ?? {}) as Record<string, unknown>;
  if (provider === "KAKAO") {
    const acct = (p.kakao_account ?? {}) as Record<string, unknown>;
    const prof = (acct.profile ?? {}) as Record<string, unknown>;
    const email = typeof acct.email === "string" ? acct.email.trim().toLowerCase() : null;
    return {
      provider,
      providerAccountId: account.providerAccountId,
      email,
      emailVerified: Boolean(email) && acct.is_email_valid === true && acct.is_email_verified === true,
      name: typeof prof.nickname === "string" ? prof.nickname : null,
    };
  }
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : null;
  return {
    provider,
    providerAccountId: account.providerAccountId,
    email,
    emailVerified: Boolean(email) && p.email_verified === true,
    name: typeof p.name === "string" ? p.name : null,
  };
}

export type ResolveResult = { kind: "user"; uid: string } | { kind: "pending"; pending: PendingProfile } | { kind: "denied"; code: "email_taken" | "inactive" };

/**
 * 소셜 로그인 → 우리 사용자 (FR-AUTH-030 "소셜 계정 연결").
 * 1. (provider, providerAccountId) 로 찾는다 — 있으면 그 사용자
 * 2. 없고 이메일이 있으면:
 *    - 같은 이메일 사용자가 있고 제공자가 검증을 보증 → 자동 연결 (provider/provider_account_id 갱신, 비밀번호는 유지)
 *    - 같은 이메일 사용자가 있는데 미검증 → 거부 (기존 계정으로 로그인 후 명시적 연결 — 2기)
 *    - 없으면 신규 생성. email_verified_at 은 보증될 때만 기록
 * 3. 이메일이 없으면 pending — /signup/complete 에서 입력받아 completePendingProfile() 로 마무리
 */
export async function resolveOAuthUser(id: OAuthIdentity): Promise<ResolveResult> {
  const [byAccount] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(and(eq(users.provider, id.provider), eq(users.providerAccountId, id.providerAccountId)))
    .limit(1);
  if (byAccount) return byAccount.status === "ACTIVE" ? { kind: "user", uid: byAccount.id } : { kind: "denied", code: "inactive" };

  if (!id.email) return { kind: "pending", pending: { provider: id.provider, providerAccountId: id.providerAccountId, name: id.name } };

  const [byEmail] = await db.select({ id: users.id, status: users.status, provider: users.provider }).from(users).where(eq(users.email, id.email)).limit(1);
  if (byEmail) {
    if (!id.emailVerified) return { kind: "denied", code: "email_taken" };
    if (byEmail.status !== "ACTIVE") return { kind: "denied", code: "inactive" };
    // 낙관적 잠금: 그 사이 다른 소셜이 먼저 연결됐으면 0행 — 이번 로그인은 거절한다
    const linked = await db
      .update(users)
      .set({ provider: id.provider, providerAccountId: id.providerAccountId, emailVerifiedAt: new Date() })
      .where(and(eq(users.id, byEmail.id), eq(users.provider, byEmail.provider)))
      .returning({ id: users.id });
    if (linked.length !== 1) return { kind: "denied", code: "email_taken" };
    return { kind: "user", uid: byEmail.id };
  }

  const [created] = await db
    .insert(users)
    .values({
      email: id.email,
      name: id.name?.trim() || "회원",
      provider: id.provider,
      providerAccountId: id.providerAccountId,
      emailVerifiedAt: id.emailVerified ? new Date() : null,
    })
    .returning({ id: users.id });
  return { kind: "user", uid: created.id };
}

/** pending 상태의 소셜 사용자가 이메일을 입력해 가입을 끝낸다 (검증은 비동기 링크). 이메일 충돌이면 null */
export async function completePendingProfile(pending: PendingProfile, email: string, name: string): Promise<{ uid: string } | { error: "email_taken" }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { error: "email_taken" };
  const [byAccount] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.provider, pending.provider), eq(users.providerAccountId, pending.providerAccountId)))
    .limit(1);
  if (byAccount) return { uid: byAccount.id }; // 이미 끝난 가입 (새로고침·중복 제출)
  const [created] = await db
    .insert(users)
    .values({ email, name, provider: pending.provider, providerAccountId: pending.providerAccountId })
    .returning({ id: users.id });
  return { uid: created.id };
}
