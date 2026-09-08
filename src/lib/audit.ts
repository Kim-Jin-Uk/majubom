import { createHash } from "node:crypto";
import { db, type DbLike } from "@/db/client";
import { auditLogs, type auditActionEnum } from "@/db/schema";
import type { RequestMeta } from "@/lib/request-meta";

export type AuditAction = (typeof auditActionEnum.enumValues)[number];
export type ActorRole = "ADMIN" | "OWNER" | "MANAGER" | "CUSTOMER" | "SYSTEM";

export type AuditEntry = {
  action: AuditAction;
  actorId?: string | null;
  actorRole?: ActorRole | null;
  businessId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** 변경된 필드만 (FR-ADM-040). 연락처·이메일 원문은 넣지 않는다 — hashPii 를 거친다. */
  diff?: Record<string, unknown> | null;
  meta?: RequestMeta;
};

/**
 * 감사 로그 적재 (FR-ADM-040 · FR-PRIV-010).
 * - 트랜잭션 밖(기본): best-effort — 실패해도 본 작업을 되돌리지 않고 로그만 남긴다. 로그 적재 실패로 로그인·예약이 막히면 안 된다.
 * - 트랜잭션 안(tx 전달): **실패를 다시 던진다.** PG 는 트랜잭션 안의 문장 실패로 aborted 상태가 되고, 이후 COMMIT 은
 *   조용히 ROLLBACK 으로 바뀐다(드리즐은 command tag 를 확인하지 않는다). 여기서 삼키면 "성공했다고 리턴했는데 아무것도
 *   저장되지 않은" 사고가 난다(리뷰 지적). 호출자는 감사 로그가 트랜잭션의 일부여야 하는지 판단해 tx 를 넘긴다.
 */
export async function writeAudit(entry: AuditEntry, tx?: DbLike): Promise<void> {
  const values = {
    action: entry.action,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    businessId: entry.businessId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    diff: entry.diff ?? null,
    ip: entry.meta?.ip ?? null,
    userAgent: entry.meta?.userAgent ?? null,
  };
  if (tx) {
    await tx.insert(auditLogs).values(values);
    return;
  }
  try {
    await db.insert(auditLogs).values(values);
  } catch (e) {
    console.error("[audit] write failed", entry.action, (e as Error).message);
  }
}

/** 이메일·연락처를 로그에 남길 때 쓰는 단방향 해시. 같은 값은 같은 해시 → 집계·조회는 가능, 복원은 불가. */
export function hashPii(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
