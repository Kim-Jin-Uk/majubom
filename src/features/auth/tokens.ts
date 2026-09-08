import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db, type DbLike } from "@/db/client";
import { authTokens } from "@/db/schema";
import { EMAIL_VERIFY_TTL_HOURS, INVITE_TTL_HOURS, OTP_MAX_ATTEMPTS, OTP_TTL_MIN, PASSWORD_RESET_TTL_MIN } from "./constants";
import { randomOtp, randomToken, sha256 } from "./crypto";

export type TokenKind = "EMAIL_OTP" | "EMAIL_VERIFY" | "INVITE" | "PASSWORD_RESET";

export const TOKEN_TTL_SEC: Record<TokenKind, number> = {
  EMAIL_OTP: OTP_TTL_MIN * 60,
  EMAIL_VERIFY: EMAIL_VERIFY_TTL_HOURS * 3600,
  INVITE: INVITE_TTL_HOURS * 3600,
  PASSWORD_RESET: PASSWORD_RESET_TTL_MIN * 60,
};

/**
 * 단일사용 토큰 (auth_tokens). 원문은 메일로만 나가고 DB 에는 해시만 남는다.
 * 같은 (user, kind) 의 이전 미사용 토큰은 새 발급 시 폐기한다 — "재발송" 이 옛 링크를 살려두지 않게.
 */
export async function issueToken(kind: Exclude<TokenKind, "EMAIL_OTP">, userId: string, ip: string | null, tx: DbLike = db): Promise<string> {
  const raw = randomToken();
  await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await tx.insert(authTokens).values({
    kind,
    userId,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_SEC[kind] * 1000),
    ip,
  });
  return raw;
}

export type ConsumeResult = { ok: true; userId: string; tokenId: string } | { ok: false; reason: "INVALID" | "EXPIRED" | "USED" };

/** 토큰을 소비한다 (원자적 UPDATE — 두 요청이 동시에 와도 하나만 성공). */
export async function consumeToken(kind: Exclude<TokenKind, "EMAIL_OTP">, raw: string, tx: DbLike = db): Promise<ConsumeResult> {
  if (!raw || raw.length < 20 || raw.length > 200) return { ok: false, reason: "INVALID" };
  const hash = sha256(raw);
  const now = new Date();
  const rows = await tx
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.kind, kind), eq(authTokens.tokenHash, hash), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ id: authTokens.id, userId: authTokens.userId });
  if (rows.length === 1 && rows[0].userId) return { ok: true, userId: rows[0].userId, tokenId: rows[0].id };
  const [row] = await tx
    .select({ usedAt: authTokens.usedAt, expiresAt: authTokens.expiresAt })
    .from(authTokens)
    .where(and(eq(authTokens.kind, kind), eq(authTokens.tokenHash, hash)))
    .limit(1);
  if (!row) return { ok: false, reason: "INVALID" };
  if (row.usedAt) return { ok: false, reason: "USED" };
  return { ok: false, reason: "EXPIRED" };
}

/** 토큰 상태만 본다 (수락 페이지가 만료 여부를 먼저 보여줄 때). 소비하지 않는다 */
export async function peekToken(kind: Exclude<TokenKind, "EMAIL_OTP">, raw: string): Promise<ConsumeResult> {
  if (!raw || raw.length < 20 || raw.length > 200) return { ok: false, reason: "INVALID" };
  const [row] = await db
    .select({ id: authTokens.id, userId: authTokens.userId, usedAt: authTokens.usedAt, expiresAt: authTokens.expiresAt })
    .from(authTokens)
    .where(and(eq(authTokens.kind, kind), eq(authTokens.tokenHash, sha256(raw))))
    .limit(1);
  if (!row || !row.userId) return { ok: false, reason: "INVALID" };
  if (row.usedAt) return { ok: false, reason: "USED" };
  if (row.expiresAt <= new Date()) return { ok: false, reason: "EXPIRED" };
  return { ok: true, userId: row.userId, tokenId: row.id };
}

/** 이메일 OTP 발급 — 6자리. 해시는 사용자에 묶어(userId:code) 다른 사용자의 코드와 충돌하지 않게 한다 */
export async function issueOtp(userId: string, ip: string | null, tx: DbLike = db): Promise<string> {
  const code = randomOtp();
  await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, "EMAIL_OTP"), isNull(authTokens.usedAt)));
  await tx.insert(authTokens).values({
    kind: "EMAIL_OTP",
    userId,
    tokenHash: sha256(`${userId}:${code}`),
    expiresAt: new Date(Date.now() + TOKEN_TTL_SEC.EMAIL_OTP * 1000),
    ip,
  });
  return code;
}

export type OtpResult = { ok: true } | { ok: false; reason: "INVALID" | "EXPIRED" | "TOO_MANY" | "NONE" };

/**
 * OTP 검증. 살아 있는 최신 토큰 하나를 대상으로, **시도 횟수 증가와 상한 검사를 한 UPDATE 로** 처리한다 —
 * `UPDATE … SET attempts = attempts + 1 WHERE … AND attempts < MAX RETURNING token_hash`. 읽고-검사하고-쓰는 방식이면
 * 동시 요청 N개가 전부 attempts=0 을 읽어 상한이 무력해진다(리뷰 지적). 맞으면 used_at 을 찍고, 상한에 닿으면 폐기한다.
 */
export async function verifyOtp(userId: string, code: string, tx: DbLike = db): Promise<OtpResult> {
  const now = new Date();
  const [live] = await tx
    .select({ id: authTokens.id, expiresAt: authTokens.expiresAt, attempts: authTokens.attempts })
    .from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, "EMAIL_OTP"), isNull(authTokens.usedAt)))
    .orderBy(desc(authTokens.createdAt))
    .limit(1);
  if (!live) return { ok: false, reason: "NONE" };
  if (live.expiresAt <= now) return { ok: false, reason: "EXPIRED" };

  // 원자적으로 시도 1회를 소비한다. 상한에 이미 닿았으면 0행
  const [claimed] = await tx
    .update(authTokens)
    .set({ attempts: sql`${authTokens.attempts} + 1` })
    .where(and(eq(authTokens.id, live.id), isNull(authTokens.usedAt), lt(authTokens.attempts, OTP_MAX_ATTEMPTS)))
    .returning({ tokenHash: authTokens.tokenHash, attempts: authTokens.attempts });
  if (!claimed) {
    await tx.update(authTokens).set({ usedAt: now }).where(and(eq(authTokens.id, live.id), isNull(authTokens.usedAt)));
    return { ok: false, reason: "TOO_MANY" };
  }

  if (claimed.tokenHash === sha256(`${userId}:${code}`)) {
    const rows = await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.id, live.id), isNull(authTokens.usedAt)))
      .returning({ id: authTokens.id });
    return rows.length === 1 ? { ok: true } : { ok: false, reason: "INVALID" };
  }
  if (claimed.attempts >= OTP_MAX_ATTEMPTS) {
    await tx.update(authTokens).set({ usedAt: now }).where(eq(authTokens.id, live.id));
    return { ok: false, reason: "TOO_MANY" };
  }
  return { ok: false, reason: "INVALID" };
}
