import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
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
 * 요약 지표(FR-SCH-030): 근무일 수, 총 근무시간(휴게 제외), 휴무일 수, 예정 예약 건수 — 자원별, 요청 기간 기준
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
  // 타임존은 파라미터가 아니라 리터럴로 — 같은 식이 SELECT 와 GROUP BY 에 각각 다른 $n 으로 바인딩되면 PG 가 같은 식으로 보지 않는다
  const tzLit = sql.raw(`'${b.tz.replace(/'/g, "''")}'`);
  const localDate = sql<string>`(${reservations.startAt} at time zone ${tzLit})::date::text`;
  const counts = await db
    .select({ resourceId: reservations.resourceId, date: localDate, n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.businessId, businessId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gte(localDate, from), lte(localDate, to)))
    .groupBy(reservations.resourceId, localDate);
  const countMap = new Map(counts.map((c) => [`${c.resourceId}|${c.date}`, c.n]));

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
        reservations: days.reduce((n, d) => n + d.reservations, 0),
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
