import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, businesses, users } from "@/db/schema";
import { z } from "zod";
import { HttpError } from "@/features/auth/errors";
import { isoDateSchema } from "@/lib/dates";

/**
 * 감사 로그 조회 (FR-ADM-040, #68). **읽기 전용이다** — 적재는 `lib/audit.ts` 가 한다.
 *
 * 이 화면의 쓸모는 "무슨 일이 있었나" 를 **사후에** 되짚는 것이다. 그래서 최신순 고정이고,
 * 정렬을 고르게 하지 않는다 — 오래된 순으로 보는 조사는 없다.
 *
 * **연락처·이메일은 이미 해시로 적재된다**(`hashPii`). 여기서 다시 가릴 것이 없고, 반대로 복원할 수도 없다 —
 * diff 에 64자 hex 가 보이면 그건 원문이 아니라 해시다. 화면이 그렇게 읽히도록 짧게 줄여 보여 준다.
 */
export type AuditRow = {
  id: string;
  at: Date;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  businessName: string | null;
  targetType: string | null;
  targetId: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
};

export type AuditQuery = {
  action?: string;
  /** 사업장 이름·slug 부분 일치 */
  business?: string;
  /** 행위자 이름·이메일 부분 일치 */
  actor?: string;
  from?: string;
  to?: string;
  /** 이어 읽기 — 직전 페이지 마지막 행의 `${createdAt.toISOString()}|${id}` */
  cursor?: string;
};

/** 한 번에 읽는 수. 감사 로그는 금세 수십만 행이 되므로 커서로만 넘긴다 */
export const AUDIT_PAGE = 50;

export const auditQuerySchema = z.object({
  action: z.string().max(40).optional(),
  business: z.string().trim().max(80).optional(),
  actor: z.string().trim().max(80).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(200).optional(),
});

/**
 * 커서는 `(createdAt, id)` 쌍이다. `createdAt` 만 쓰면 같은 밀리초에 쌓인 행이 페이지 경계에서 빠지거나 겹친다 —
 * 감사 로그는 배치가 한 번에 수백 건을 같은 시각으로 적재한다.
 */
export function parseCursor(raw: string | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split("|");
  const d = new Date(at);
  if (Number.isNaN(d.getTime()) || !id) throw new HttpError(400, "INVALID_CURSOR");
  return { at: d, id };
}

/** 다음 페이지 커서. 마지막 행이 없거나 더 읽을 것이 없으면 null */
export function nextCursorOf(rows: Array<{ at: Date; id: string }>, pageSize: number): string | null {
  if (rows.length <= pageSize) return null;
  const last = rows[pageSize - 1];
  return last ? `${last.at.toISOString()}|${last.id}` : null;
}

/** `to` 는 그날을 **포함**한다 — 사람이 "9/14까지" 라고 쓸 때 9/14 를 빼면 놀란다 */
export function endOfDayExclusive(date: string): Date {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000);
}

export async function listAuditLogs(q: AuditQuery = {}): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
  const cursor = parseCursor(q.cursor);
  const actorTerm = q.actor?.trim();
  const bizTerm = q.business?.trim();

  const rows = await db
    .select({
      id: auditLogs.id,
      at: auditLogs.createdAt,
      action: auditLogs.action,
      actorName: users.name,
      actorRole: auditLogs.actorRole,
      businessName: businesses.name,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      diff: auditLogs.diff,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .leftJoin(businesses, eq(businesses.id, auditLogs.businessId))
    .where(
      and(
        q.action ? eq(auditLogs.action, q.action as never) : undefined,
        q.from ? gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00Z`)) : undefined,
        q.to ? lt(auditLogs.createdAt, endOfDayExclusive(q.to)) : undefined,
        actorTerm ? or(sql`${users.name} ilike ${`%${actorTerm}%`}`, sql`${users.email} ilike ${`%${actorTerm}%`}`) : undefined,
        bizTerm ? or(sql`${businesses.name} ilike ${`%${bizTerm}%`}`, sql`${businesses.slug} ilike ${`%${bizTerm}%`}`) : undefined,
        // 커서: 같은 시각이면 id 로 가른다
        cursor ? or(lt(auditLogs.createdAt, cursor.at), and(eq(auditLogs.createdAt, cursor.at), lt(auditLogs.id, cursor.id))) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE + 1);

  const page = rows.slice(0, AUDIT_PAGE);
  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      // 이메일은 고르지도 않는다 — 조회 화면은 "누가" 를 알면 되고 연락처를 늘어놓을 자리가 아니다
      actorName: r.actorName,
      actorRole: r.actorRole,
      businessName: r.businessName,
      targetType: r.targetType,
      targetId: r.targetId,
      diff: r.diff,
      ip: r.ip,
    })),
    nextCursor: nextCursorOf(rows, AUDIT_PAGE),
  };
}

/**
 * 필터 드롭다운에 **실제로 쌓인 action 만** 낸다. enum 30종을 전부 늘어놓으면
 * 대부분이 0건인 목록에서 고르게 되고, "없는 걸 골랐나" 와 "정말 없나" 가 구분되지 않는다.
 */
export async function usedActions(): Promise<Array<{ action: string; count: number }>> {
  const rows = await db
    .select({ action: auditLogs.action, count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .groupBy(auditLogs.action)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ action: r.action, count: r.count }));
}
