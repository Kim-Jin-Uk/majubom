import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, reservations, resources } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { holidaysForRange, type HolidayItem } from "./holidays";
import { dateRange, fmtMin, holidayApplies, resolveWorkDay, totalMinutes, type DaySource, type Interval } from "./resolve";
import { listExceptions, ownResourceId, type Actor, type ExceptionItem } from "./work-exceptions";
import { schedulesForRange } from "./work-schedules";

/**
 * 근무표 조회 (FR-SCH-030, #41). 자원 × 날짜 그리드를 한 번에 계산해 돌려준다 — 화면은 계산하지 않는다.
 * - OWNER: 전체 자원. 인원 부족일(근무자 0명인 영업일) 표시용으로 날짜별 근무 인원 수를 함께
 * - MANAGER: 내 근무표(내 자원 전부) + 팀 근무표(동료는 근무 여부·시간만, 사유 없음 — FR-SCH-030)
 * 요약 지표(FR-SCH-030): 근무일 수, 총 근무시간(휴게 제외), 휴무일 수, 예정 예약 건수 — 자원별, 요청 기간 기준. 예약 건수는 시작일 또는 종료일이 기간에 드는 예약 (자정 넘긴 예약은 양쪽 날짜 셀에 표시, 요약에는 1건)
 */
export type DayCell = {
  date: string;
  work: Array<{ start: string; end: string }>;
  bookable: Array<{ start: string; end: string }>;
  workMinutes: number;
  source: DaySource;
  closed: boolean;
  /** 사업장 전체 휴무 메모 (있으면) */
  holiday: string | null;
  exceptions: Array<{ id: string; kind: ExceptionItem["kind"]; startTime: string | null; endTime: string | null; reason: string | null }>;
  reservations: number;
};

export type ResourceRow = {
  resourceId: string;
  name: string;
  isActive: boolean;
  mine: boolean;
  days: DayCell[];
  summary: { workDays: number; workMinutes: number; offDays: number; reservations: number };
};

export type ScheduleGrid = {
  from: string;
  to: string;
  dates: string[];
  /** 날짜별: 영업일인가, 사업장 휴무 메모, 근무 인원 수 */
  dayMeta: Array<{ date: string; open: boolean; holiday: string | null; staffOnDuty: number }>;
  rows: ResourceRow[];
  holidays: HolidayItem[];
};

const fmtI = (l: Interval[]) => l.map((i) => ({ start: fmtMin(i.start), end: fmtMin(i.end) }));

export async function getScheduleGrid(businessId: string, from: string, to: string, actor: Actor, opts: { resourceIds?: string[] } = {}): Promise<ScheduleGrid> {
  const dates = dateRange(from, to);
  if (dates.length === 0 || dates.length > 62) throw new HttpError(400, "INVALID_RANGE");
  const [b] = await db.select({ openingHours: businesses.openingHours, tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  const mine = actor.role === "OWNER" ? null : await ownResourceId(businessId, actor.memberId);

  const staff = await db
    .select({ id: resources.id, name: resources.name, isActive: resources.isActive })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.type, "STAFF"), opts.resourceIds?.length ? inArray(resources.id, opts.resourceIds) : undefined))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));

  const [schedules, exceptions, hols] = await Promise.all([schedulesForRange(businessId, from, to), listExceptions(businessId, from, to, actor), holidaysForRange(businessId, from, to)]);

  // 자원·날짜별 예약 수 (REQUESTED/CONFIRMED)
  // 자정을 넘겨 끝나는 예약은 시작일과 종료일 양쪽 날짜에 잡힌 것으로 본다 (holidays.ts reservationsOnDates 와 같은 기준) — 날짜 셀은 "그날 손님이 오는 건수", 요약은 예약 건수(중복 없이)
  const localDate = sql<string>`(${reservations.startAt} at time zone ${b.tz})::date::text`;
  const localEndDate = sql<string>`(${reservations.endAt} at time zone ${b.tz})::date::text`;
  const touched = await db
    .select({ resourceId: reservations.resourceId, startDate: localDate, endDate: localEndDate })
    .from(reservations)
    .where(and(eq(reservations.businessId, businessId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), or(and(gte(localDate, from), lte(localDate, to)), and(gte(localEndDate, from), lte(localEndDate, to)))));
  const countMap = new Map<string, number>();
  const totalMap = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const t of touched) {
    bump(totalMap, t.resourceId);
    if (t.startDate >= from && t.startDate <= to) bump(countMap, `${t.resourceId}|${t.startDate}`);
    if (t.endDate !== t.startDate && t.endDate >= from && t.endDate <= to) bump(countMap, `${t.resourceId}|${t.endDate}`);
  }

  const rows: ResourceRow[] = staff.map((r) => {
    const days = dates.map((date): DayCell => {
      const day = resolveWorkDay({ date, resourceId: r.id, openingHours: b.openingHours, schedules, exceptions, holidays: hols });
      const bizHoliday = day.holidays.find((h) => h.resourceId === null && h.isFullDay) ?? day.holidays.find((h) => h.resourceId === r.id && h.isFullDay) ?? null;
      return {
        date,
        work: fmtI(day.work),
        bookable: fmtI(day.bookable),
        workMinutes: totalMinutes(day.work),
        source: day.source,
        closed: day.closed,
        holiday: bizHoliday ? ((bizHoliday as HolidayItem).memo ?? (bizHoliday.resourceId ? "자원 휴무" : "휴무")) : null,
        exceptions: day.exceptions.map((e) => {
          const x = e as ExceptionItem;
          return { id: x.id, kind: x.kind, startTime: x.startTime ?? null, endTime: x.endTime ?? null, reason: x.reason ?? null };
        }),
        reservations: countMap.get(`${r.id}|${date}`) ?? 0,
      };
    });
    return {
      resourceId: r.id,
      name: r.name,
      isActive: r.isActive,
      mine: r.id === mine,
      days,
      summary: {
        workDays: days.filter((d) => d.workMinutes > 0).length,
        workMinutes: days.reduce((n, d) => n + d.workMinutes, 0),
        offDays: days.filter((d) => d.workMinutes === 0 && !d.closed).length,
        reservations: totalMap.get(r.id) ?? 0,
      },
    };
  });

  const dayMeta = dates.map((date) => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const open = b.openingHours.some((o) => o.dow === dow);
    const bizHoliday = hols.find((h) => h.resourceId === null && h.isFullDay && holidayApplies(h, date)) ?? null;
    return {
      date,
      open: open && !bizHoliday,
      holiday: bizHoliday ? (bizHoliday.memo ?? "휴무") : null,
      staffOnDuty: rows.filter((r) => r.isActive && (r.days.find((d) => d.date === date)?.workMinutes ?? 0) > 0).length,
    };
  });

  return { from, to, dates, dayMeta, rows, holidays: hols };
}
