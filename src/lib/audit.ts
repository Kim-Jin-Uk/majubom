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
 * 감사 로그 적재 (FR-ADM-040 · FR-PRIV-010). 실패해도 본 작업을 되돌리지 않는다 — 로그 적재 실패로
 * 로그인이나 예약이 막히면 안 된다. 대신 Sentry 로 보낸다(호출자가 트랜잭션 안에서 부르면 같은 tx 를 쓴다).
 */
export async function writeAudit(entry: AuditEntry, tx: DbLike = db): Promise<void> {
  try {
    await tx.insert(auditLogs).values({
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      businessId: entry.businessId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      diff: entry.diff ?? null,
      ip: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
    });
  } catch (e) {
    // 감사 로그는 best-effort. 실패는 관측만 한다.
    console.error("[audit] write failed", entry.action, (e as Error).message);
  }
}

/** 이메일·연락처를 로그에 남길 때 쓰는 단방향 해시. 같은 값은 같은 해시 → 집계·조회는 가능, 복원은 불가. */
export function hashPii(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
