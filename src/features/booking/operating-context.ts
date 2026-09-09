import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, resources, workExceptions, workSchedules } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { holidaysForRange } from "@/features/schedule/holidays";
import { addDays } from "@/features/schedule/resolve";
import type { Dow, Holiday, ISODate, OpeningHoursEntry, ResourceType, WorkException, WorkSchedule } from "./slot-types";

/**
 * 사업장 전체의 운영시간 계산 입력 — 상품에 매이지 않는다.
 * `booking/context.ts` 는 상품 하나에 연결된 자원만 싣기 때문에 콘솔 지표(가동률·캘린더)에는 못 쓴다.
 * 한 번 읽어 기간 전체를 계산한다 (반복 휴무 전개는 메모리에서 — 명세 성능 절).
 */

const asDow = (n: number) => n as Dow;

export type OperatingContext = {
  tz: string;
  openingHours: Array<Omit<OpeningHoursEntry, "dow"> & { dow: number }>;
  resources: Array<{ id: string; name: string; type: ResourceType; capacity: number; isActive: boolean; sortOrder: number; memberId: string | null }>;
  schedules: WorkSchedule[];
  exceptions: WorkException[];
  holidays: Holiday[];
};

export async function loadOperatingContext(businessId: string, from: ISODate, to: ISODate): Promise<OperatingContext> {
  const [b] = await db.select({ tz: businesses.timezone, openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  const rs = await db
    .select({ id: resources.id, name: resources.name, type: resources.type, capacity: resources.capacity, isActive: resources.isActive, sortOrder: resources.sortOrder, memberId: resources.memberId })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.isActive, true)))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));

  const [sched, exs, hols] = await Promise.all([
    db
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.businessId, businessId), lte(workSchedules.effectiveFrom, to), or(sql`${workSchedules.effectiveTo} is null`, gte(workSchedules.effectiveTo, from)))),
    // 승인된 예외만 — 대기 중인 휴가는 아직 근무표가 아니다 (slots.ts 와 같은 기준)
    db
      .select()
      .from(workExceptions)
      .where(and(eq(workExceptions.businessId, businessId), eq(workExceptions.status, "APPROVED"), gte(workExceptions.date, addDays(from, -1)), lte(workExceptions.date, to))),
    holidaysForRange(businessId, from, to),
  ]);

  return {
    tz: b.tz,
    // DB 의 breaks 는 nullable, 계산기는 undefined 를 기대한다
    openingHours: b.openingHours.map((o) => ({ dow: o.dow, open: o.open, close: o.close, breaks: o.breaks ?? undefined })),
    resources: rs,
    schedules: sched.map((s): WorkSchedule => ({ resourceId: s.resourceId, dayOfWeek: asDow(s.dayOfWeek), startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5), breaks: (s.breaks ?? []).map((x) => ({ start: x.start, end: x.end })), effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo })),
    exceptions: exs.map((e): WorkException => ({ resourceId: e.resourceId, date: e.date, kind: e.kind, startTime: e.startTime?.slice(0, 5) ?? null, endTime: e.endTime?.slice(0, 5) ?? null })),
    holidays: hols.map((h): Holiday => ({ resourceId: h.resourceId, type: h.type, startDate: h.startDate, endDate: h.endDate, dayOfWeek: h.dayOfWeek, dayOfMonth: h.dayOfMonth, isLastDayOfMonth: h.isLastDayOfMonth, month: h.month, isFullDay: h.isFullDay, startTime: h.startTime, endTime: h.endTime, repeatUntil: h.repeatUntil })),
  };
}

