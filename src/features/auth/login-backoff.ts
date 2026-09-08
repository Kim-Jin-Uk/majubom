import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { hashPii, writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { LOGIN_FAIL_FREE_ATTEMPTS, LOGIN_FAIL_IP_MAX_PER_WINDOW, LOGIN_FAIL_MAX_DELAY_SEC, LOGIN_FAIL_WINDOW_MIN } from "./constants";

/**
 * 로그인 실패 지수 백오프 (FR-AUTH-030): 15분 창에서 5회 실패부터 1s → 2s → 4s … 32s.
 * 별도 테이블 없이 감사 로그(LOGIN_FAIL, target = 이메일 해시)를 카운터로 쓴다 — 실패는 어차피 전부 감사 로그 대상이고,
 * 인스턴스가 여러 개여도 DB 가 하나라 일관된다. 계정 기준 백오프(공격자가 IP 를 바꿔도 계정은 보호) + IP 기준 상한
 * (`ipBlocked` — 계정을 바꿔 가며 찍는 크리덴셜 스터핑·scrypt 비용 폭주 방어) 둘을 같이 쓴다.
 * 백오프에 걸린 시도는 **로그를 남기지 않는다** — 그렇지 않으면 공격이 자기 백오프를 연장하고 로그를 무한히 늘린다.
 */
export type BackoffState = { blocked: boolean; retryAfterSec: number; fails: number };

/** `email` 자리에는 계정 키가 온다 — 이메일 또는 "totp:<uid>" 같은 용도별 키. 해시되어 저장된다 */
export async function loginBackoff(email: string): Promise<BackoffState> {
  const since = new Date(Date.now() - LOGIN_FAIL_WINDOW_MIN * 60_000);
  const rows = await db
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "LOGIN_FAIL"), eq(auditLogs.targetId, hashPii(email)), gt(auditLogs.createdAt, since)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(LOGIN_FAIL_FREE_ATTEMPTS + 6);
  const fails = rows.length;
  if (fails < LOGIN_FAIL_FREE_ATTEMPTS) return { blocked: false, retryAfterSec: 0, fails };
  const delay = Math.min(2 ** (fails - LOGIN_FAIL_FREE_ATTEMPTS), LOGIN_FAIL_MAX_DELAY_SEC);
  const last = rows[0].createdAt.getTime();
  const remainingMs = last + delay * 1000 - Date.now();
  return remainingMs > 0 ? { blocked: true, retryAfterSec: Math.ceil(remainingMs / 1000), fails } : { blocked: false, retryAfterSec: 0, fails };
}

export async function recordLoginFail(email: string, meta: RequestMeta, reason: "NO_USER" | "BAD_PASSWORD" | "INACTIVE" | "SOCIAL_ONLY" | "BACKOFF" | "BAD_TOTP"): Promise<void> {
  await writeAudit({
    action: "LOGIN_FAIL",
    actorRole: null,
    targetType: "EMAIL",
    targetId: hashPii(email),
    diff: { reason },
    meta,
  });
}

/** IP 단위 상한: 15분 창에 LOGIN_FAIL_IP_MAX_PER_WINDOW 건 이상이면 차단. IP 를 모르면 "알 수 없음" 버킷(ip IS NULL) 으로 센다 */
export async function ipBlocked(ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_FAIL_WINDOW_MIN * 60_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "LOGIN_FAIL"), ip ? eq(auditLogs.ip, ip) : sql`${auditLogs.ip} IS NULL`, gt(auditLogs.createdAt, since)));
  return n >= LOGIN_FAIL_IP_MAX_PER_WINDOW;
}
