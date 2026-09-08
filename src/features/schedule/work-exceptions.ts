import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { isoDateSchema as dateSchema } from "@/lib/dates";
import { db, type DbLike } from "@/db/client";
import { businesses, resources, workExceptions } from "@/db/schema";
import type { WorkException } from "@/features/booking/slot-types";
import { HttpError } from "@/features/auth/errors";
import { timeSchema, toMin } from "@/features/business/hours";
import { holidaysForRange, reservationsOnDates, type ConflictingReservation } from "./holidays";
import { resolveWorkDay, span, subtract, type Interval } from "./resolve";
import { schedulesForRange } from "./work-schedules";

/**
 * 일자별 근무 예외 (FR-SCH-020 WorkException, #40 · FR-SCH-040 개인 차단, #42).
 * OFF 그날 휴무 · MODIFIED 시간 변경 · EXTRA 추가 근무 · BLOCK 부분 차단. 우선순위 해석은 resolve.ts.
 *
 * 기존 예약 충돌: 예외로 **사라지는 근무 구간**에 REQUESTED/CONFIRMED 예약이 있으면 목록을 돌려주고(409 EXCEPTION_CONFLICT) 확인을 받는다.
 * OWNER 는 confirmConflicts 로 강행할 수 있다(예약은 그대로 — 사장님이 처리한다). 매니저의 BLOCK 은 명세대로 예약이 있으면 등록 불가.
 * 매니저는 본인 계정이 연결된 STAFF 자원에만, kind 는 BLOCK 만 (그날 휴무·시간 변경은 교대 에픽에서 요청 흐름으로).
 * reason 은 본인과 OWNER 만 본다 (FR-SCH-030) — 조회 함수가 가린다.
 */

export const exceptionInputSchema = z
  .object({
    resourceId: z.uuid(),
    date: dateSchema,
    kind: z.enum(["OFF", "MODIFIED", "BLOCK", "EXTRA"]),
    startTime: timeSchema.nullable().optional(),
    endTime: timeSchema.nullable().optional(),
    reason: z.string().trim().max(200, "사유는 200자 이내").nullable().optional(),
    /** 사라지는 근무 구간에 예약이 있어도 등록 (OWNER 만) */
    confirmConflicts: z.boolean().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.kind !== "OFF") {
      if (!e.startTime || !e.endTime) ctx.addIssue({ code: "custom", path: ["startTime"], message: "시간 구간이 필요합니다" });
      else if (toMin(e.endTime) <= toMin(e.startTime)) ctx.addIssue({ code: "custom", path: ["endTime"], message: "끝 시각이 시작 시각보다 뒤여야 합니다" });
    }
  });
export type ExceptionInput = z.output<typeof exceptionInputSchema>;

export type ExceptionItem = WorkException & { id: string; reason: string | null; createdBy: string; createdAt: Date };

export type Actor = { uid: string; role: "OWNER" | "MANAGER"; memberId: string };

/** 매니저 본인 계정이 연결된 STAFF 자원 id (없으면 null) */
export async function ownResourceId(businessId: string, memberId: string, q: DbLike = db): Promise<string | null> {
  const [r] = await q.select({ id: resources.id }).from(resources).where(and(eq(resources.businessId, businessId), eq(resources.memberId, memberId))).limit(1);
  return r?.id ?? null;
}

export async function listExceptions(businessId: string, from: string, to: string, actor: Actor, q: DbLike = db): Promise<ExceptionItem[]> {
  const mine = actor.role === "OWNER" ? null : await ownResourceId(businessId, actor.memberId, q);
  const rows = await q
    .select()
    .from(workExceptions)
    .where(and(eq(workExceptions.businessId, businessId), gte(workExceptions.date, from), lte(workExceptions.date, to)))
    .orderBy(asc(workExceptions.date), asc(workExceptions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    resourceId: r.resourceId,
    date: r.date,
    kind: r.kind,
    startTime: r.startTime?.slice(0, 5) ?? null,
    endTime: r.endTime?.slice(0, 5) ?? null,
    // 개인 사유는 본인과 OWNER 만 (FR-SCH-030)
    reason: actor.role === "OWNER" || r.resourceId === mine ? r.reason : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}


export async function createException(businessId: string, input: ExceptionInput, actor: Actor): Promise<{ id: string; conflicts: ConflictingReservation[] }> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select({ id: resources.id, type: resources.type, memberId: resources.memberId }).from(resources).where(and(eq(resources.id, input.resourceId), eq(resources.businessId, businessId))).limit(1);
    if (!r) throw new HttpError(404, "NOT_FOUND");
    if (r.type !== "STAFF") throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["resourceId"], message: "근무 예외는 담당자(STAFF) 자원에만 둘 수 있습니다. 공간은 휴무일로 막아 주세요" }] });
    if (actor.role !== "OWNER") {
      if (r.memberId !== actor.memberId) throw new HttpError(403, "NOT_OWN_RESOURCE");
      if (input.kind !== "BLOCK") throw new HttpError(403, "MANAGER_BLOCK_ONLY");
    }
    const [b] = await tx.select({ openingHours: businesses.openingHours, tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!b) throw new HttpError(404, "NOT_FOUND");

    // 그날 근무 구간을 "예외 전" 과 "예외 후" 로 두 번 계산해 차이(사라지는 구간)를 구한다 — 기존 EXTRA 등 살아남는 구간을 잘못 충돌로 잡지 않는다
    const [schedules, exceptions, hols] = await Promise.all([schedulesForRange(businessId, input.date, input.date, tx), listExceptions(businessId, input.date, input.date, { ...actor, role: "OWNER" }, tx), holidaysForRange(businessId, input.date, input.date, tx)]);
    const same = exceptions.filter((e) => e.resourceId === input.resourceId && e.date === input.date);
    // 같은 날 OFF·MODIFIED 는 하나만 — 둘이면 어느 것이 적용되는지 정의되지 않는다. 바꾸려면 지우고 다시 등록
    if ((input.kind === "OFF" || input.kind === "MODIFIED") && same.some((e) => e.kind === input.kind)) throw new HttpError(409, "EXCEPTION_EXISTS", { kind: input.kind });
    const ctxBase = { date: input.date, resourceId: input.resourceId, openingHours: b.openingHours, schedules, holidays: hols };
    const before = resolveWorkDay({ ...ctxBase, exceptions }).work;
    const candidate: WorkException = { resourceId: input.resourceId, date: input.date, kind: input.kind, startTime: input.kind === "OFF" ? null : input.startTime, endTime: input.kind === "OFF" ? null : input.endTime };
    const after = resolveWorkDay({ ...ctxBase, exceptions: [...exceptions, candidate] }).work;
    // BLOCK 은 명세(FR-SCH-040) 그대로 "그 구간에 예약이 있으면" — 근무 여부와 무관하게 구간 자체를 본다. 나머지는 사라지는 근무 구간
    const removed: Interval[] = input.kind === "BLOCK" ? [span(input.startTime!, input.endTime!)] : subtract(before, after);
    let conflicts: ConflictingReservation[] = [];
    for (const cut of removed) conflicts.push(...(await reservationsOnDates(businessId, [input.date], { resourceId: input.resourceId, cut, tz: b.tz }, tx)));
    conflicts = [...new Map(conflicts.map((c) => [c.id, c])).values()];
    if (conflicts.length > 0) {
      // 매니저의 BLOCK 은 예약이 있으면 등록 불가 (FR-SCH-040) — 먼저 예약을 처리해야 한다
      if (actor.role !== "OWNER") throw new HttpError(409, "BLOCK_HAS_RESERVATIONS", { reservations: conflicts });
      if (!input.confirmConflicts) throw new HttpError(409, "EXCEPTION_CONFLICT", { reservations: conflicts });
    }
    const [row] = await tx
      .insert(workExceptions)
      .values({
        businessId,
        resourceId: input.resourceId,
        date: input.date,
        kind: input.kind,
        startTime: input.kind === "OFF" ? null : input.startTime!,
        endTime: input.kind === "OFF" ? null : input.endTime!,
        reason: input.reason || null,
        createdBy: actor.uid,
      })
      .returning({ id: workExceptions.id });
    return { id: row.id, conflicts };
  });
}

export async function deleteException(businessId: string, id: string, actor: Actor): Promise<void> {
  const [cur] = await db
    .select({ id: workExceptions.id, kind: workExceptions.kind, memberId: resources.memberId })
    .from(workExceptions)
    .innerJoin(resources, eq(resources.id, workExceptions.resourceId))
    .where(and(eq(workExceptions.id, id), eq(workExceptions.businessId, businessId)))
    .limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  if (actor.role !== "OWNER" && (cur.memberId !== actor.memberId || cur.kind !== "BLOCK")) throw new HttpError(403, "NOT_OWN_RESOURCE");
  await db.delete(workExceptions).where(eq(workExceptions.id, id));
}
