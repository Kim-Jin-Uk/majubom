import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { deviceLabel, type RequestMeta } from "@/lib/request-meta";
import { REFRESH_TTL_SEC, ROTATION_GRACE_SEC } from "./constants";
import { randomToken, sha256 } from "./crypto";

/**
 * 서버 저장 리프레시 토큰 (FR-AUTH-030 세션 정책, 06 §5).
 *
 * 쿠키 원문 = `${sid}.${secret}`. DB 에는 sha256(secret) 만 있다.
 * 회전: rotate() 마다 secret 이 바뀌고 직전 해시는 prev_token_hash 에 ROTATION_GRACE 동안 남는다.
 * 만료: expires_at 은 생성 시점 + 30일로 고정 — 리프레시해도 늘어나지 않는다 (절대 만료).
 */
export type RefreshToken = { sid: string; secret: string };

export function serializeRefresh(t: RefreshToken): string {
  return `${t.sid}.${t.secret}`;
}

export function parseRefresh(raw: string | undefined | null): RefreshToken | null {
  if (!raw) return null;
  const i = raw.indexOf(".");
  if (i <= 0) return null;
  const sid = raw.slice(0, i);
  const secret = raw.slice(i + 1);
  if (!/^[0-9a-f-]{36}$/.test(sid) || secret.length < 32) return null;
  return { sid, secret };
}

export async function createSession(userId: string, meta: RequestMeta): Promise<RefreshToken> {
  const secret = randomToken();
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(secret),
      deviceLabel: deviceLabel(meta.userAgent),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
    })
    .returning({ id: sessions.id });
  return { sid: row.id, secret };
}

export type RotateResult =
  /** rotated=false 는 유예 창 통과 — 쿠키를 갈아쓰면 안 된다 (다른 요청이 이미 새 토큰을 심었다) */
  | { ok: true; userId: string; token: RefreshToken; rotated: boolean }
  | { ok: false; reason: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "MISMATCH" };

/**
 * 제시된 리프레시 토큰을 검증하고 회전한다. 한 번의 UPDATE 로 검증과 회전을 원자적으로 처리해
 * 동시 요청이 와도 둘 중 하나만 새 토큰을 받고, 나머지는 유예 창 안에서 직전 토큰으로 통과한다.
 */
export async function rotateSession(token: RefreshToken, meta: RequestMeta): Promise<RotateResult> {
  const presented = sha256(token.secret);
  const newSecret = randomToken();
  const now = new Date();
  const graceFloor = new Date(now.getTime() - ROTATION_GRACE_SEC * 1000);

  // 1) 현재 해시와 일치 → 회전
  const rotated = await db
    .update(sessions)
    .set({
      tokenHash: sha256(newSecret),
      prevTokenHash: presented,
      rotatedAt: now,
      lastUsedAt: now,
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    })
    .where(and(eq(sessions.id, token.sid), eq(sessions.tokenHash, presented), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .returning({ userId: sessions.userId });
  if (rotated.length === 1) return { ok: true, userId: rotated[0].userId, token: { sid: token.sid, secret: newSecret }, rotated: true };

  // 2) 현재 해시와 다름 — 직전 해시 + 유예 안이면 통과, 아니면 폐기
  const [row] = await db
    .select({
      userId: sessions.userId,
      tokenHash: sessions.tokenHash,
      prevTokenHash: sessions.prevTokenHash,
      rotatedAt: sessions.rotatedAt,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.id, token.sid))
    .limit(1);
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (row.revokedAt) return { ok: false, reason: "REVOKED" };
  if (row.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (row.prevTokenHash === presented && row.rotatedAt && row.rotatedAt >= graceFloor) {
    // 같은 브라우저의 동시 요청 — 먼저 도착한 쪽이 이미 새 토큰을 쿠키에 심었다. 이 요청은 통과만 시키고
    // 쿠키는 건드리지 않는다 (rotated=false). 현재 secret 은 DB 에 해시로만 있어 돌려줄 수도 없다.
    return { ok: true, userId: row.userId, token, rotated: false };
  }
  // 재사용 감지(유예 밖의 옛 토큰) — 탈취 가능성. 세션 전체를 폐기한다.
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, token.sid));
  return { ok: false, reason: "MISMATCH" };
}

export async function revokeSession(sid: string, userId?: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt), userId ? eq(sessions.userId, userId) : undefined))
    .returning({ id: sessions.id });
  return rows.length === 1;
}

/** 비활성화·정지·비밀번호 변경: 사용자 세션 전부 폐기. 폐기된 수를 돌려준다 */
export async function revokeAllSessions(userId: string, exceptSid?: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSid ? sql`${sessions.id} <> ${exceptSid}` : undefined))
    .returning({ id: sessions.id });
  return rows.length;
}

export type SessionListItem = {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
};

/** 활성 세션 목록 (기기 관리 화면). 폐기·만료된 것은 제외 */
export async function listSessions(userId: string, currentSid?: string): Promise<SessionListItem[]> {
  const rows = await db
    .select({
      id: sessions.id,
      deviceLabel: sessions.deviceLabel,
      ip: sessions.ip,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((r) => ({ ...r, current: r.id === currentSid }));
}

/** 폐기·만료되지 않은 세션인가 (콘솔 매 요청 검사용, 인덱스 1회) */
export async function isSessionAlive(sid: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return Boolean(row);
}
