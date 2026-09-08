import { and, eq, isNull, lt } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { RequestMeta } from "@/lib/request-meta";
import { TOTP_FAIL_HARD_LOCK } from "./constants";
import { decryptSecret, encryptSecret } from "./crypto";
import { loginBackoff, recordLoginFail } from "./login-backoff";

/**
 * ADMIN TOTP 2단계 인증 (FR-AUTH-030 "ADMIN: TOTP 2단계 인증 필수").
 * - 시크릿은 AUTH_SECRET 파생 키로 암호화해 users.totp_secret_enc 에. 활성화 전(등록 중)에도 같은 컬럼을 쓰고 totp_enabled_at 이 null.
 * - 검증 성공 시 라우트가 서버 증명(serverProof)으로 JWT 의 mfa 를 ok 로 올린다. 이 모듈은 코드 검증만.
 * - 오입력은 로그인 실패와 같은 백오프(5회부터 1s→32s), LOGIN_FAIL 감사 로그(target = "totp:" + uid 해시). 10회면 하드락.
 * - 부트스트랩 주의: 미등록 ADMIN 은 비밀번호만으로 시크릿을 등록할 수 있다(그 시점엔 2FA 가 없으니 당연하다).
 *   승격(admin:promote) 직후 **곧바로** /login/totp 에서 등록을 끝내는 것이 운영 절차다 — README 참고.
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

export type TotpVerify = { ok: true; enabledNow: boolean } | { ok: false; reason: "NO_SECRET" | "INVALID" | "LOCKED" | "HARD_LOCK"; retryAfterSec?: number };

/**
 * 코드 검증. 성공한 스텝(30초 단위)을 users.totp_last_step 에 기록하고 그 이하 스텝은 거절한다 — 같은 코드 재사용(리플레이) 차단.
 * 15분 창에서 TOTP_FAIL_HARD_LOCK 회 이상 실패하면 HARD_LOCK — 호출 라우트가 세션을 폐기해 비밀번호부터 다시 밟게 한다.
 */
export async function verifyTotp(uid: string, code: string, meta: RequestMeta): Promise<TotpVerify> {
  const key = `totp:${uid}`;
  const backoff = await loginBackoff(key);
  if (backoff.fails >= TOTP_FAIL_HARD_LOCK) return { ok: false, reason: "HARD_LOCK" };
  if (backoff.blocked) return { ok: false, reason: "LOCKED", retryAfterSec: backoff.retryAfterSec };

  const [u] = await db
    .select({ enc: users.totpSecretEnc, enabledAt: users.totpEnabledAt, email: users.email, lastStep: users.totpLastStep })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  if (!u?.enc) return { ok: false, reason: "NO_SECRET" };
  const secret = decryptSecret(u.enc, authSecret());
  const t = totp(secret, u.email);
  // window 1 = 앞뒤 30초 허용 (기기 시계 오차)
  const delta = t.validate({ token: code, window: 1 });
  const step = delta === null ? null : Math.floor(Date.now() / 1000 / t.period) + delta;
  if (step === null || (u.lastStep !== null && step <= u.lastStep)) {
    await recordLoginFail(key, meta, "BAD_TOTP");
    return { ok: false, reason: "INVALID" };
  }
  // 스텝 기록도 조건부 UPDATE — 동시 요청 둘이 같은 코드를 내면 하나만 통과
  const rows = await db
    .update(users)
    .set({ totpLastStep: step, ...(u.enabledAt ? {} : { totpEnabledAt: new Date() }) })
    .where(and(eq(users.id, uid), u.lastStep === null ? isNull(users.totpLastStep) : lt(users.totpLastStep, step)))
    .returning({ id: users.id });
  if (rows.length !== 1) {
    await recordLoginFail(key, meta, "BAD_TOTP");
    return { ok: false, reason: "INVALID" };
  }
  return { ok: true, enabledNow: !u.enabledAt };
}
