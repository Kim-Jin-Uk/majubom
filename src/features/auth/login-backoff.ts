import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { hashPii, writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { LOGIN_FAIL_FREE_ATTEMPTS, LOGIN_FAIL_MAX_DELAY_SEC, LOGIN_FAIL_WINDOW_MIN } from "./constants";

/**
 * 로그인 실패 지수 백오프 (FR-AUTH-030): 15분 창에서 5회 실패부터 1s → 2s → 4s … 32s.
 * 별도 테이블 없이 감사 로그(LOGIN_FAIL, target = 이메일 해시)를 카운터로 쓴다 — 실패는 어차피 전부 감사 로그 대상이고,
 * 인스턴스가 여러 개여도 DB 가 하나라 일관된다. IP 기준이 아니라 계정 기준: 공격자가 IP 를 바꿔도 계정은 보호된다.
 */
export type BackoffState = { blocked: boolean; retryAfterSec: number; fails: number };

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

export async function recordLoginFail(email: string, meta: RequestMeta, reason: "NO_USER" | "BAD_PASSWORD" | "INACTIVE" | "SOCIAL_ONLY" | "BACKOFF"): Promise<void> {
  await writeAudit({
    action: "LOGIN_FAIL",
    actorRole: null,
    targetType: "EMAIL",
    targetId: hashPii(email),
    diff: { reason },
    meta,
  });
}
