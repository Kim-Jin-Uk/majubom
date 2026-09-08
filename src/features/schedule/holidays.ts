import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { isoDateSchema as dateSchema } from "@/lib/dates";
import { db, type DbLike } from "@/db/client";
import { businesses, holidays, reservations, resources, users } from "@/db/schema";
import type { Holiday } from "@/features/booking/slot-types";
import { HttpError } from "@/features/auth/errors";
import { timeSchema } from "@/features/business/hours";
import { addDays, holidayApplies, span, type Interval } from "./resolve";

/**
 * 휴무일 (FR-SCH-010, #38). 사업장 전체(resourceId null) 또는 자원별. 유형: ONCE · WEEKLY · MONTHLY_DAY · YEARLY. 전일 또는 부분(시간 구간).
 *
 * 미래 확정·대기 예약이 있는 날에 등록하면 그 예약 목록을 돌려주고(409 HOLIDAY_CONFLICT) 확인을 받는다.
 * 명세의 두 선택지 중 "예약 유지(휴무일이지만 예약은 진행)" 는 keepReservations 로 지금 된다. "일괄 취소 + 고객 알림" 은 예약 콘솔 에픽에서
 * 예약 취소·알림이 생기면 붙인다(HOLIDAY_BULK_CANCEL 감사 action 은 이미 있다) — 여기서 조용히 취소하지 않는다.
 * 반복 휴무의 충돌 검사는 앞으로 365일치 발생일을 본다 (maxAdvanceDays 상한이 365 이고, 콘솔 대리 예약은 그 제한도 받지 않는다).
 */

export const holidayInputSchema = z
  .object({
    resourceId: z.uuid().nullable().default(null),
    type: z.enum(["ONCE", "WEEKLY", "MONTHLY_DAY", "YEARLY"]),
    startDate: dateSchema,
    endDate: dateSchema.nullable().optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    isLastDayOfMonth: z.boolean().default(false),
    month: z.number().int().min(1).max(12).nullable().optional(),
    isFullDay: z.boolean().default(true),
    startTime: timeSchema.nullable().optional(),
    endTime: timeSchema.nullable().optional(),
    repeatUntil: dateSchema.nullable().optional(),
    memo: z.string().trim().max(100, "메모는 100자 이내").nullable().optional(),
    /** 미래 예약이 있어도 등록 (예약은 그대로 진행) */
    keepReservations: z.boolean().optional(),
  })
  .superRefine((h, ctx) => {
    if (h.type === "ONCE" && h.endDate && h.endDate < h.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "종료일이 시작일보다 앞입니다" });
    if (h.type === "WEEKLY" && h.dayOfWeek == null) ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "요일을 골라 주세요" });
    if (h.type === "MONTHLY_DAY" && !h.isLastDayOfMonth && h.dayOfMonth == null) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "날짜(1~31) 또는 말일을 골라 주세요" });
    if (h.type !== "ONCE" && h.repeatUntil && h.repeatUntil < h.startDate) ctx.addIssue({ code: "custom", path: ["repeatUntil"], message: "반복 종료일이 시작일보다 앞입니다" });
    if (!h.isFullDay) {
      if (!h.startTime || !h.endTime) ctx.addIssue({ code: "custom", path: ["startTime"], message: "부분 휴무는 시간 구간이 필요합니다" });
      else if (h.endTime <= h.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "끝 시각이 시작 시각보다 뒤여야 합니다" });
    }
  });
export type HolidayInput = z.output<typeof holidayInputSchema>;

export type HolidayItem = Holiday & { id: string; memo: string | null; resourceName: string | null; createdAt: Date };

export async function listHolidays(businessId: string, q: DbLike = db): Promise<HolidayItem[]> {
  const rows = await q
    .select({
      id: holidays.id,
      resourceId: holidays.resourceId,
      resourceName: resources.name,
      type: holidays.type,
      startDate: holidays.startDate,
      endDate: holidays.endDate,
      dayOfWeek: holidays.dayOfWeek,
      dayOfMonth: holidays.dayOfMonth,
      isLastDayOfMonth: holidays.isLastDayOfMonth,
      month: holidays.month,
      isFullDay: holidays.isFullDay,
      startTime: holidays.startTime,
      endTime: holidays.endTime,
      repeatUntil: holidays.repeatUntil,
      memo: holidays.memo,
      createdAt: holidays.createdAt,
    })
    .from(holidays)
    .leftJoin(resources, eq(resources.id, holidays.resourceId))
    .where(eq(holidays.businessId, businessId))
    .orderBy(asc(holidays.startDate), asc(holidays.createdAt));
  return rows.map((r) => ({ ...r, dayOfWeek: r.dayOfWeek as Holiday["dayOfWeek"], startTime: r.startTime?.slice(0, 5) ?? null, endTime: r.endTime?.slice(0, 5) ?? null }));
}

/** 오늘부터 앞으로 days 일 안에서 이 휴무가 적용되는 날짜들 */
export function upcomingOccurrences(h: Holiday, today: string, days = 365): string[] {
  const from = h.type === "ONCE" ? (h.startDate > today ? h.startDate : today) : today;
  const to = h.type === "ONCE" ? (h.endDate ?? h.startDate) : addDays(today, days);
  if (to < from) return [];
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) if (holidayApplies(h, d)) out.push(d);
  return out;
}

export type ConflictingReservation = { id: string; code: string; startAt: Date; endAt: Date; resourceName: string; customerName: string | null; status: string };

/** 그 날짜들에 잡힌 REQUESTED/CONFIRMED 예약 — 부분 휴무면 시간 구간과 겹치는 것만 */
export async function reservationsOnDates(businessId: string, dates: string[], opts: { resourceId: string | null; cut: Interval | null; tz: string }, q: DbLike = db): Promise<ConflictingReservation[]> {
  if (dates.length === 0) return [];
  const localDate = sql<string>`(${reservations.startAt} at time zone ${opts.tz})::date::text`;
  const localEndDate = sql<string>`(${reservations.endAt} at time zone ${opts.tz})::date::text`;
  const localMin = sql<number>`(extract(hour from (${reservations.startAt} at time zone ${opts.tz})) * 60 + extract(minute from (${reservations.startAt} at time zone ${opts.tz})))::int`;
  const localEndMin = sql<number>`(extract(hour from (${reservations.endAt} at time zone ${opts.tz})) * 60 + extract(minute from (${reservations.endAt} at time zone ${opts.tz})))::int`;
  const rows = await q
    .select({ id: reservations.id, code: reservations.code, startAt: reservations.startAt, endAt: reservations.endAt, resourceName: resources.name, customerName: users.name, status: reservations.status, startMin: localMin, endMin: localEndMin, sameDay: sql<boolean>`(${reservations.startAt} at time zone ${opts.tz})::date = (${reservations.endAt} at time zone ${opts.tz})::date` })
    .from(reservations)
    .innerJoin(resources, eq(resources.id, reservations.resourceId))
    .leftJoin(users, eq(users.id, reservations.customerId))
    .where(
      and(
        eq(reservations.businessId, businessId),
        inArray(reservations.status, ["REQUESTED", "CONFIRMED"]),
        // 전날 저녁에 시작해 자정을 넘겨 그 날짜에 끝나는 예약도 그 날짜의 충돌이다
        or(inArray(localDate, dates), inArray(localEndDate, dates)),
        opts.resourceId ? eq(reservations.resourceId, opts.resourceId) : undefined,
      ),
    )
    .orderBy(asc(reservations.startAt));
  const cut = opts.cut;
  return rows
    .filter((r) => {
      if (!cut) return true;
      const end = r.sameDay ? r.endMin : r.endMin + 1440; // 자정 넘긴 예약
      return r.startMin < cut.end && end > cut.start;
    })
    .map((r) => ({ id: r.id, code: r.code, startAt: r.startAt, endAt: r.endAt, resourceName: r.resourceName, customerName: r.customerName, status: r.status }));
}

async function businessTz(businessId: string, q: DbLike): Promise<string> {
  const [b] = await q.select({ tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  return b.tz;
}

export async function createHoliday(businessId: string, input: HolidayInput, today: string): Promise<{ id: string; conflicts: ConflictingReservation[] }> {
  return db.transaction(async (tx) => {
    if (input.resourceId) {
      const [r] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, input.resourceId), eq(resources.businessId, businessId))).limit(1);
      if (!r) throw new HttpError(404, "NOT_FOUND");
    }
    const h: Holiday = {
      resourceId: input.resourceId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.type === "ONCE" ? (input.endDate ?? input.startDate) : null,
      dayOfWeek: input.type === "WEEKLY" ? (input.dayOfWeek as Holiday["dayOfWeek"]) : null,
      dayOfMonth: input.type === "MONTHLY_DAY" && !input.isLastDayOfMonth ? input.dayOfMonth : null,
      isLastDayOfMonth: input.type === "MONTHLY_DAY" ? input.isLastDayOfMonth : false,
      month: input.type === "YEARLY" ? (input.month ?? Number(input.startDate.slice(5, 7))) : null,
      isFullDay: input.isFullDay,
      startTime: input.isFullDay ? null : input.startTime,
      endTime: input.isFullDay ? null : input.endTime,
      repeatUntil: input.type === "ONCE" ? null : (input.repeatUntil ?? null),
    };
    const tz = await businessTz(businessId, tx);
    const dates = upcomingOccurrences(h, today);
    const conflicts = await reservationsOnDates(businessId, dates, { resourceId: h.resourceId, cut: h.isFullDay ? null : span(h.startTime!, h.endTime!), tz }, tx);
    if (conflicts.length > 0 && !input.keepReservations) throw new HttpError(409, "HOLIDAY_CONFLICT", { reservations: conflicts });
    const [row] = await tx
      .insert(holidays)
      .values({
        businessId,
        resourceId: h.resourceId,
        type: h.type,
        startDate: h.startDate,
        endDate: h.endDate,
        dayOfWeek: h.dayOfWeek ?? null,
        dayOfMonth: h.dayOfMonth ?? null,
        isLastDayOfMonth: h.isLastDayOfMonth ?? false,
        month: h.month ?? null,
        isFullDay: h.isFullDay,
        startTime: h.startTime ?? null,
        endTime: h.endTime ?? null,
        repeatUntil: h.repeatUntil ?? null,
        memo: input.memo || null,
      })
      .returning({ id: holidays.id });
    return { id: row.id, conflicts };
  });
}

export async function deleteHoliday(businessId: string, id: string): Promise<void> {
  const rows = await db.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.businessId, businessId))).returning({ id: holidays.id });
  if (rows.length !== 1) throw new HttpError(404, "NOT_FOUND");
}

/** 기간 안에 적용될 수 있는 휴무 — 반복 규칙은 전부, ONCE 는 기간과 겹치는 것만 */
export async function holidaysForRange(businessId: string, from: string, to: string, q: DbLike = db): Promise<HolidayItem[]> {
  const all = await listHolidays(businessId, q);
  return all.filter((h) => (h.type === "ONCE" ? h.startDate <= to && (h.endDate ?? h.startDate) >= from : (!h.repeatUntil || h.repeatUntil >= from) && h.startDate <= to));
}

