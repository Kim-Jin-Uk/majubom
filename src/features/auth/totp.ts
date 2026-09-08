import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { RequestMeta } from "@/lib/request-meta";
import { decryptSecret, encryptSecret } from "./crypto";
import { loginBackoff, recordLoginFail } from "./login-backoff";

/**
 * ADMIN TOTP 2단계 인증 (FR-AUTH-030 "ADMIN: TOTP 2단계 인증 필수").
 * - 시크릿은 AUTH_SECRET 파생 키로 암호화해 users.totp_secret_enc 에. 활성화 전(등록 중)에도 같은 컬럼을 쓰고 totp_enabled_at 이 null.
 * - 검증 성공 시 라우트가 서버 증명(serverProof)으로 JWT 의 mfa 를 ok 로 올린다. 이 모듈은 코드 검증만.
 * - 오입력은 로그인 실패와 같은 백오프(5회부터 1s→32s), LOGIN_FAIL 감사 로그(target = "totp:" + uid 해시).
 */
const ISSUER = "마주,봄";

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET 이 없다");
  return s;
}

function totp(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

export type TotpSetup = { secret: string; uri: string };

/** 새 시크릿 발급(등록 시작). 이미 활성화된 사용자는 재등록 불가 — 관리자 재설정 절차(2기)로 */
export async function beginTotpSetup(uid: string, label: string): Promise<TotpSetup | { error: "ALREADY_ENABLED" }> {
  const [u] = await db.select({ totpEnabledAt: users.totpEnabledAt }).from(users).where(eq(users.id, uid)).limit(1);
  if (!u) throw new Error("사용자 없음");
  if (u.totpEnabledAt) return { error: "ALREADY_ENABLED" };
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await db.update(users).set({ totpSecretEnc: encryptSecret(secret, authSecret()) }).where(eq(users.id, uid));
  return { secret, uri: totp(secret, label).toString() };
}

export type TotpVerify = { ok: true; enabledNow: boolean } | { ok: false; reason: "NO_SECRET" | "INVALID" | "LOCKED"; retryAfterSec?: number };

export async function verifyTotp(uid: string, code: string, meta: RequestMeta): Promise<TotpVerify> {
  const key = `totp:${uid}`;
  const backoff = await loginBackoff(key);
  if (backoff.blocked) return { ok: false, reason: "LOCKED", retryAfterSec: backoff.retryAfterSec };

  const [u] = await db.select({ enc: users.totpSecretEnc, enabledAt: users.totpEnabledAt, email: users.email }).from(users).where(eq(users.id, uid)).limit(1);
  if (!u?.enc) return { ok: false, reason: "NO_SECRET" };
  const secret = decryptSecret(u.enc, authSecret());
  // window 1 = 앞뒤 30초 허용 (기기 시계 오차)
  const delta = totp(secret, u.email).validate({ token: code, window: 1 });
  if (delta === null) {
    await recordLoginFail(key, meta, "BAD_TOTP");
    return { ok: false, reason: "INVALID" };
  }
  let enabledNow = false;
  if (!u.enabledAt) {
    await db.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, uid));
    enabledNow = true;
  }
  return { ok: true, enabledNow };
}
