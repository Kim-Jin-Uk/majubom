import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { isoDateSchema as dateSchema } from "@/lib/dates";
import { db, type DbLike } from "@/db/client";
import { businesses, resources, users, workExceptions } from "@/db/schema";
import type { WorkException } from "@/features/booking/slot-types";
import { HttpError } from "@/features/auth/errors";
import { timeSchema, toMin } from "@/features/business/hours";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { holidaysForRange, reservationsOnDates, type ConflictingReservation } from "./holidays";
import { resolveWorkDay, span, subtract, type Interval } from "./resolve";
import { schedulesForRange } from "./work-schedules";

/**
 * 일자별 근무 예외 (FR-SCH-020 WorkException, #40 · FR-SCH-040 개인 차단, #42 · 매니저 휴가 신청).
 * OFF 그날 휴무 · MODIFIED 시간 변경 · EXTRA 추가 근무 · BLOCK 부분 차단. 우선순위 해석은 resolve.ts.
 *
 * 상태: 사장님이 직접 둔 예외와 매니저의 차단(BLOCK)은 바로 APPROVED. 매니저의 **휴가 신청**(leave: 종일이면 OFF, 시간 단위면 BLOCK)은
 * PENDING 으로 들어와 사장님이 승인(APPROVED)해야 근무표에 적용된다 — 근무표 계산은 APPROVED 만 본다. 반려(REJECTED)는 사유와 함께 신청자에게 보인다.
 *
 * 기존 예약 충돌: 예외로 **사라지는 근무 구간**에 REQUESTED/CONFIRMED 예약이 있으면 목록을 돌려주고(409 EXCEPTION_CONFLICT) 확인을 받는다.
 * OWNER 는 confirmConflicts 로 강행할 수 있다(예약은 그대로 — 사장님이 처리한다). 휴가 신청은 등록 시점이 아니라 **승인 시점**에 검사한다.
 * 매니저의 즉시 차단은 명세대로 예약이 있으면 등록 불가(409 BLOCK_HAS_RESERVATIONS).
 * 매니저는 본인 계정이 연결된 STAFF 자원에만. 사장님 알림(신청 도착)은 알림 에픽에서 — 지금은 근무표 상단 '승인 대기' 패널이 그 역할.
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
    /** 휴가 신청 — 사장님 승인 후 적용 (MANAGER · kind 는 OFF 또는 BLOCK). OWNER 가 보내면 무시(바로 적용) */
    leave: z.boolean().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.kind !== "OFF") {
      if (!e.startTime || !e.endTime) ctx.addIssue({ code: "custom", path: ["startTime"], message: "시간 구간이 필요합니다" });
      else if (toMin(e.endTime) <= toMin(e.startTime)) ctx.addIssue({ code: "custom", path: ["endTime"], message: "끝 시각이 시작 시각보다 뒤여야 합니다" });
    }
  });
export type ExceptionInput = z.output<typeof exceptionInputSchema>;

export const decisionInputSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  /** 반려 사유 (신청자에게 보인다) */
  note: z.string().trim().max(200, "사유는 200자 이내").nullable().optional(),
  /** 승인 시 사라지는 근무 구간에 예약이 있어도 승인 */
  confirmConflicts: z.boolean().optional(),
});
export type DecisionInput = z.output<typeof decisionInputSchema>;

export type ExceptionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ExceptionItem = WorkException & {
  id: string;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
  status: ExceptionStatus;
  /** 신청을 거쳐 승인·반려된 것이면 시각 (사장님이 직접 둔 예외는 null) */
  decidedAt: Date | null;
  /** 반려 사유 — 본인·OWNER 만 */
  decisionNote: string | null;
};

export type Actor = { uid: string; role: "OWNER" | "MANAGER"; memberId: string };

/** 매니저 본인 계정이 연결된 STAFF 자원 id (없으면 null) */
export async function ownResourceId(businessId: string, memberId: string, q: DbLike = db): Promise<string | null> {
  const [r] = await q.select({ id: resources.id }).from(resources).where(and(eq(resources.businessId, businessId), eq(resources.memberId, memberId))).limit(1);
  return r?.id ?? null;
}

/** 근무표 계산에 쓰는 것 — 승인된 예외만 */
export const applicable = <T extends { status: ExceptionStatus }>(list: T[]): T[] => list.filter((e) => e.status === "APPROVED");

/**
 * 기간의 예외 — 상태 전부. 반려된 것은 OWNER 와 신청자 본인에게만 보인다(동료의 반려 이력은 남의 일).
 * 개인 사유·반려 사유는 본인과 OWNER 만 (FR-SCH-030).
 */
export async function listExceptions(businessId: string, from: string, to: string, actor: Actor, q: DbLike = db): Promise<ExceptionItem[]> {
  const mine = actor.role === "OWNER" ? null : await ownResourceId(businessId, actor.memberId, q);
  const rows = await q
    .select()
    .from(workExceptions)
    .where(and(eq(workExceptions.businessId, businessId), gte(workExceptions.date, from), lte(workExceptions.date, to)))
    .orderBy(asc(workExceptions.date), asc(workExceptions.createdAt));
  return rows.filter((r) => r.status !== "REJECTED" || actor.role === "OWNER" || r.resourceId === mine).map((r) => toItem(r, actor.role === "OWNER" || r.resourceId === mine));
}

function toItem(r: typeof workExceptions.$inferSelect, canSeeReason: boolean): ExceptionItem {
  return {
    id: r.id,
    resourceId: r.resourceId,
    date: r.date,
    kind: r.kind,
    startTime: r.startTime?.slice(0, 5) ?? null,
    endTime: r.endTime?.slice(0, 5) ?? null,
    reason: canSeeReason ? r.reason : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    status: r.status,
    decidedAt: r.decidedAt,
    decisionNote: canSeeReason ? r.decisionNote : null,
  };
}

export type LeaveRequest = ExceptionItem & { resourceName: string; requesterName: string };

/**
 * 휴가 신청 목록. OWNER: 승인 대기 전부(날짜 지난 것도 — 결정 버튼은 이 목록에만 있으니 영구 대기가 생기지 않게). MANAGER: 본인 신청 중 대기·반려 (오늘 이후).
 */
export async function listLeaveRequests(businessId: string, actor: Actor, today: string): Promise<LeaveRequest[]> {
  const mine = actor.role === "OWNER" ? null : await ownResourceId(businessId, actor.memberId);
  if (actor.role !== "OWNER" && !mine) return [];
  const rows = await db
    .select({ x: workExceptions, resourceName: resources.name, requesterName: users.name })
    .from(workExceptions)
    .innerJoin(resources, eq(resources.id, workExceptions.resourceId))
    .innerJoin(users, eq(users.id, workExceptions.createdBy))
    .where(and(eq(workExceptions.businessId, businessId), mine ? and(eq(workExceptions.resourceId, mine), gte(workExceptions.date, today)) : eq(workExceptions.status, "PENDING")))
    .orderBy(asc(workExceptions.date), asc(workExceptions.createdAt));
  return rows.filter((r) => r.x.status !== "APPROVED").map((r) => ({ ...toItem(r.x, true), resourceName: r.resourceName, requesterName: r.requesterName ?? "" }));
}

/**
 * 예외 하나가 그날 근무에서 없애는 구간의 예약 — "예외 전" 과 "예외 후" 를 두 번 계산해 차이를 구한다(살아남는 EXTRA 구간을 잘못 충돌로 잡지 않는다).
 * BLOCK 은 명세(FR-SCH-040) 그대로 구간 자체. 그날의 예외 전체(상태 불문)도 함께 돌려준다 — 중복 검사용
 */
async function conflictsFor(businessId: string, candidate: WorkException, tz: string, tx: DbLike): Promise<{ conflicts: ConflictingReservation[]; exceptions: ExceptionItem[] }> {
  const [b] = await tx.select({ openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  const owner: Actor = { uid: "", role: "OWNER", memberId: "" };
  const [schedules, exceptions, hols] = await Promise.all([schedulesForRange(businessId, candidate.date, candidate.date, tx), listExceptions(businessId, candidate.date, candidate.date, owner, tx), holidaysForRange(businessId, candidate.date, candidate.date, tx)]);
  const approved = applicable(exceptions);
  const ctxBase = { date: candidate.date, resourceId: candidate.resourceId, openingHours: b.openingHours, schedules, holidays: hols };
  const before = resolveWorkDay({ ...ctxBase, exceptions: approved }).work;
  const after = resolveWorkDay({ ...ctxBase, exceptions: [...approved, candidate] }).work;
  const removed: Interval[] = candidate.kind === "BLOCK" ? [span(candidate.startTime!, candidate.endTime!)] : subtract(before, after);
  let conflicts: ConflictingReservation[] = [];
  for (const cut of removed) conflicts.push(...(await reservationsOnDates(businessId, [candidate.date], { resourceId: candidate.resourceId, cut, tz }, tx)));
  conflicts = [...new Map(conflicts.map((c) => [c.id, c])).values()];
  return { conflicts, exceptions };
}

/** 같은 날 OFF·MODIFIED 는 하나만(적용 중이거나 대기 중인 것) — 둘이면 어느 것이 적용되는지 정의되지 않는다. 바꾸려면 지우고 다시 등록 */
function assertNoDuplicate(kind: WorkException["kind"], same: ExceptionItem[]): void {
  if ((kind === "OFF" || kind === "MODIFIED") && same.some((e) => e.kind === kind && e.status !== "REJECTED")) throw new HttpError(409, "EXCEPTION_EXISTS", { kind });
}

export async function createException(businessId: string, input: ExceptionInput, actor: Actor): Promise<{ id: string; status: ExceptionStatus; conflicts: ConflictingReservation[] }> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select({ id: resources.id, type: resources.type, memberId: resources.memberId }).from(resources).where(and(eq(resources.id, input.resourceId), eq(resources.businessId, businessId))).limit(1);
    if (!r) throw new HttpError(404, "NOT_FOUND");
    if (r.type !== "STAFF") throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["resourceId"], message: "근무 예외는 담당자(STAFF) 자원에만 둘 수 있습니다. 공간은 휴무일로 막아 주세요" }] });
    const isOwner = actor.role === "OWNER";
    // 매니저: 본인 자원에만. 바로 적용되는 건 차단(BLOCK)만, 휴가 신청(leave)은 종일(OFF)·시간(BLOCK) — 시간 변경·추가 근무는 교대 에픽에서
    const asLeave = !isOwner && input.leave === true;
    if (!isOwner) {
      if (r.memberId !== actor.memberId) throw new HttpError(403, "NOT_OWN_RESOURCE");
      if (asLeave ? input.kind !== "OFF" && input.kind !== "BLOCK" : input.kind !== "BLOCK") throw new HttpError(403, "MANAGER_BLOCK_ONLY");
    }
    const [b] = await tx.select({ tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!b) throw new HttpError(404, "NOT_FOUND");

    const candidate: WorkException = { resourceId: input.resourceId, date: input.date, kind: input.kind, startTime: input.kind === "OFF" ? null : input.startTime, endTime: input.kind === "OFF" ? null : input.endTime };
    let conflicts: ConflictingReservation[] = [];
    if (asLeave) {
      // 신청은 충돌 검사를 승인 시점으로 미룬다 — 사장님이 예약을 보고 결정한다
      const same = (await listExceptions(businessId, input.date, input.date, { ...actor, role: "OWNER" }, tx)).filter((e) => e.resourceId === input.resourceId);
      assertNoDuplicate(input.kind, same);
    } else {
      const res = await conflictsFor(businessId, candidate, b.tz, tx);
      conflicts = res.conflicts;
      assertNoDuplicate(input.kind, res.exceptions.filter((e) => e.resourceId === input.resourceId));
      if (conflicts.length > 0) {
        // 매니저의 BLOCK 은 예약이 있으면 등록 불가 (FR-SCH-040) — 먼저 예약을 처리해야 한다
        if (!isOwner) throw new HttpError(409, "BLOCK_HAS_RESERVATIONS", { reservations: conflicts });
        if (!input.confirmConflicts) throw new HttpError(409, "EXCEPTION_CONFLICT", { reservations: conflicts });
      }
    }
    const status: ExceptionStatus = asLeave ? "PENDING" : "APPROVED";
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
        status,
      })
      .returning({ id: workExceptions.id });
    return { id: row.id, status, conflicts };
  });
}

/**
 * 휴가 신청 승인·반려 (OWNER). 승인은 등록과 같은 충돌 검사를 거친다 — 사라지는 근무 구간에 예약이 있으면 409 EXCEPTION_CONFLICT, confirmConflicts 로 강행.
 * 이미 처리된 신청은 409 NOT_PENDING.
 */
export async function decideException(businessId: string, id: string, input: DecisionInput, actor: Actor, meta: RequestMeta): Promise<{ status: ExceptionStatus; conflicts: ConflictingReservation[] }> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(workExceptions).where(and(eq(workExceptions.id, id), eq(workExceptions.businessId, businessId))).limit(1);
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    if (cur.status !== "PENDING") throw new HttpError(409, "NOT_PENDING", { status: cur.status });
    let conflicts: ConflictingReservation[] = [];
    let status: ExceptionStatus = "REJECTED";
    // 동시 결정 방지 — 아래 UPDATE 도 status=PENDING 조건으로 한 번 더 잠근다
    if (input.decision === "APPROVE") {
      const [b] = await tx.select({ tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
      if (!b) throw new HttpError(404, "NOT_FOUND");
      const candidate: WorkException = { resourceId: cur.resourceId, date: cur.date, kind: cur.kind, startTime: cur.startTime?.slice(0, 5) ?? null, endTime: cur.endTime?.slice(0, 5) ?? null };
      const res = await conflictsFor(businessId, candidate, b.tz, tx);
      conflicts = res.conflicts;
      // 대기 중에 사장님이 같은 날 OFF 를 직접 뒀을 수 있다
      assertNoDuplicate(cur.kind, res.exceptions.filter((e) => e.resourceId === cur.resourceId && e.id !== cur.id && e.status === "APPROVED"));
      if (conflicts.length > 0 && !input.confirmConflicts) throw new HttpError(409, "EXCEPTION_CONFLICT", { reservations: conflicts });
      status = "APPROVED";
    }
    const updated = await tx
      .update(workExceptions)
      .set({ status, decidedBy: actor.uid, decidedAt: new Date(), decisionNote: input.decision === "REJECT" ? input.note || null : null })
      .where(and(eq(workExceptions.id, id), eq(workExceptions.status, "PENDING")))
      .returning({ id: workExceptions.id });
    if (updated.length !== 1) throw new HttpError(409, "NOT_PENDING", { status: "DECIDED" });
    await writeAudit(
      { action: status === "APPROVED" ? "LEAVE_APPROVE" : "LEAVE_DENY", actorId: actor.uid, actorRole: "OWNER", businessId, targetType: "WORK_EXCEPTION", targetId: id, diff: { date: cur.date, kind: cur.kind, conflicts: conflicts.length, note: input.note ?? null }, meta },
      tx,
    );
    return { status, conflicts };
  });
}

/** 삭제. OWNER 전부. MANAGER 는 본인 자원의 (대기·반려 신청 취소) 또는 (즉시 차단 BLOCK) — 승인된 휴무는 사장님만 되돌린다 */
export async function deleteException(businessId: string, id: string, actor: Actor): Promise<void> {
  const [cur] = await db
    .select({ id: workExceptions.id, kind: workExceptions.kind, status: workExceptions.status, decidedAt: workExceptions.decidedAt, memberId: resources.memberId })
    .from(workExceptions)
    .innerJoin(resources, eq(resources.id, workExceptions.resourceId))
    .where(and(eq(workExceptions.id, id), eq(workExceptions.businessId, businessId)))
    .limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  if (actor.role !== "OWNER") {
    if (cur.memberId !== actor.memberId) throw new HttpError(403, "NOT_OWN_RESOURCE");
    // 승인된 휴가(종일이든 시간이든 — decidedAt 이 있다)는 사장님만 되돌린다. 본인이 바로 둔 차단(BLOCK, 결정 없음)만 지운다
    if (cur.status === "APPROVED" && (cur.kind !== "BLOCK" || cur.decidedAt !== null)) throw new HttpError(403, "NOT_OWN_RESOURCE");
  }
  await db.delete(workExceptions).where(eq(workExceptions.id, id));
}
