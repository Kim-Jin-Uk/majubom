import { describe, expect, it } from "vitest";
import type { Holiday, WorkException, WorkSchedule } from "@/features/booking/slot-types";
import { addDays, dateRange, dowOf, fmtMin, holidayApplies, intersect, normalize, resolveWorkDay, subtract, totalMinutes } from "./resolve";

const R = "res-1";
const opening = [1, 2, 3, 4, 5].map((dow) => ({ dow: dow as 1 | 2 | 3 | 4 | 5, open: "10:00", close: "20:00", breaks: [{ start: "13:00", end: "14:00" }] }));
const sched: WorkSchedule[] = [1, 2, 3, 4, 5].map((dow) => ({ resourceId: R, dayOfWeek: dow as 1 | 2 | 3 | 4 | 5, startTime: "10:00", endTime: "19:00", breaks: [{ start: "13:00", end: "14:00" }], effectiveFrom: "2026-01-01", effectiveTo: null }));
const THU = "2026-10-01"; // 목
const base = { resourceId: R, openingHours: opening, schedules: sched, exceptions: [] as WorkException[], holidays: [] as Holiday[] };
const fmt = (l: { start: number; end: number }[]) => l.map((i) => `${fmtMin(i.start)}-${fmtMin(i.end)}`);

describe("interval 유틸", () => {
  it("subtract / intersect / normalize", () => {
    expect(fmt(subtract([{ start: 600, end: 1140 }], [{ start: 780, end: 840 }]))).toEqual(["10:00-13:00", "14:00-19:00"]);
    expect(fmt(intersect([{ start: 600, end: 1140 }], [{ start: 540, end: 700 }, { start: 1100, end: 1300 }]))).toEqual(["10:00-11:40", "18:20-19:00"]);
    expect(fmt(normalize([{ start: 700, end: 800 }, { start: 600, end: 700 }, { start: 790, end: 900 }]))).toEqual(["10:00-15:00"]);
  });
  it("날짜 유틸 — UTC 기준, 요일, 범위", () => {
    expect(dowOf(THU)).toBe(4);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(dateRange("2026-10-01", "2026-10-07")).toHaveLength(7);
  });
});

describe("holidayApplies (FR-SCH-010 유형)", () => {
  it("ONCE 기간 · WEEKLY 요일+repeatUntil · MONTHLY_DAY(말일) · YEARLY", () => {
    const once: Holiday = { resourceId: null, type: "ONCE", startDate: "2026-09-28", endDate: "2026-09-30", isFullDay: true };
    expect(holidayApplies(once, "2026-09-29")).toBe(true);
    expect(holidayApplies(once, "2026-10-01")).toBe(false);
    const weekly: Holiday = { resourceId: null, type: "WEEKLY", startDate: "2026-09-01", dayOfWeek: 1, isFullDay: true, repeatUntil: "2026-12-31" };
    expect(holidayApplies(weekly, "2026-10-05")).toBe(true); // 월
    expect(holidayApplies(weekly, "2026-10-06")).toBe(false);
    expect(holidayApplies(weekly, "2027-01-04")).toBe(false); // repeatUntil 이후
    const last: Holiday = { resourceId: null, type: "MONTHLY_DAY", startDate: "2026-01-01", isLastDayOfMonth: true, isFullDay: true };
    expect(holidayApplies(last, "2026-02-28")).toBe(true);
    expect(holidayApplies(last, "2026-02-27")).toBe(false);
    const d15: Holiday = { resourceId: null, type: "MONTHLY_DAY", startDate: "2026-01-01", dayOfMonth: 15, isFullDay: true };
    expect(holidayApplies(d15, "2026-10-15")).toBe(true);
    const yearly: Holiday = { resourceId: null, type: "YEARLY", startDate: "2020-01-01", month: 1, isFullDay: true };
    expect(holidayApplies(yearly, "2027-01-01")).toBe(true);
    expect(holidayApplies(yearly, "2027-01-02")).toBe(false);
  });
  it("시작일 이전에는 적용되지 않는다", () => {
    expect(holidayApplies({ resourceId: null, type: "WEEKLY", startDate: "2026-11-01", dayOfWeek: 4, isFullDay: true }, THU)).toBe(false);
  });
});

describe("resolveWorkDay 우선순위 (FR-SCH-020)", () => {
  it("7 주간 패턴 − 휴게 → 근무, 예약 가능 = 근무 ∩ 영업(휴게 제외)", () => {
    const r = resolveWorkDay({ ...base, date: THU });
    expect(r.source).toBe("SCHEDULE");
    expect(fmt(r.work)).toEqual(["10:00-13:00", "14:00-19:00"]);
    expect(fmt(r.bookable)).toEqual(["10:00-13:00", "14:00-19:00"]);
    expect(totalMinutes(r.work)).toBe(480);
  });
  it("패턴이 없는 요일 · 영업 안 하는 날 → 빈 구간, closed", () => {
    const sat = "2026-10-03";
    const r = resolveWorkDay({ ...base, date: sat });
    expect(r.work).toEqual([]);
    expect(r.closed).toBe(true);
    expect(r.source).toBe("NONE");
  });
  it("effectiveFrom/To 기간 밖의 패턴은 무시", () => {
    const old: WorkSchedule[] = [{ ...sched[3], effectiveTo: "2026-09-30" }];
    expect(resolveWorkDay({ ...base, schedules: old, date: THU }).work).toEqual([]);
  });
  it("5 OFF → 근무 없음, 4 EXTRA 가 OFF 를 이긴다 (교대 유지: 근무 = EXTRA 구간뿐)", () => {
    const off: WorkException = { resourceId: R, date: THU, kind: "OFF" };
    expect(resolveWorkDay({ ...base, exceptions: [off], date: THU }).work).toEqual([]);
    const extra: WorkException = { resourceId: R, date: THU, kind: "EXTRA", startTime: "15:00", endTime: "17:00" };
    const r = resolveWorkDay({ ...base, exceptions: [off, extra], date: THU });
    expect(fmt(r.work)).toEqual(["15:00-17:00"]);
    expect(r.source).toBe("EXTRA");
  });
  it("6 MODIFIED 는 패턴을 대체, 3 BLOCK 은 구간을 깎는다", () => {
    const mod: WorkException = { resourceId: R, date: THU, kind: "MODIFIED", startTime: "12:00", endTime: "18:00" };
    const block: WorkException = { resourceId: R, date: THU, kind: "BLOCK", startTime: "15:00", endTime: "16:00" };
    const r = resolveWorkDay({ ...base, exceptions: [mod, block], date: THU });
    expect(fmt(r.work)).toEqual(["12:00-15:00", "16:00-18:00"]);
    expect(r.source).toBe("MODIFIED");
  });
  it("1·2 휴무가 항상 우선 — EXTRA 가 있어도 사업장 전일 휴무면 근무 없음, 부분 휴무는 그 구간만", () => {
    const extra: WorkException = { resourceId: R, date: THU, kind: "EXTRA", startTime: "09:00", endTime: "10:00" };
    const full: Holiday = { resourceId: null, type: "ONCE", startDate: THU, isFullDay: true };
    const r1 = resolveWorkDay({ ...base, exceptions: [extra], holidays: [full], date: THU });
    expect(r1.work).toEqual([]);
    expect(r1.source).toBe("HOLIDAY_BUSINESS");
    expect(r1.closed).toBe(true);
    const partial: Holiday = { resourceId: R, type: "WEEKLY", startDate: "2026-01-01", dayOfWeek: 4, isFullDay: false, startTime: "14:00", endTime: "16:00" };
    const r2 = resolveWorkDay({ ...base, holidays: [partial], date: THU });
    expect(fmt(r2.work)).toEqual(["10:00-13:00", "16:00-19:00"]);
    expect(r2.source).toBe("SCHEDULE");
  });
  it("다른 자원의 예외·휴무는 영향 없다", () => {
    const other: WorkException = { resourceId: "res-2", date: THU, kind: "OFF" };
    const oh: Holiday = { resourceId: "res-2", type: "ONCE", startDate: THU, isFullDay: true };
    expect(fmt(resolveWorkDay({ ...base, exceptions: [other], holidays: [oh], date: THU }).work)).toEqual(["10:00-13:00", "14:00-19:00"]);
  });
  it("익일 마감 근무(20:00~02:00)는 24h 를 더해 읽는다; 영업 밖 근무는 bookable 에서 빠진다", () => {
    const night: WorkSchedule[] = [{ resourceId: R, dayOfWeek: 4, startTime: "20:00", endTime: "02:00", breaks: [], effectiveFrom: "2026-01-01", effectiveTo: null }];
    const r = resolveWorkDay({ ...base, schedules: night, date: THU });
    expect(fmt(r.work)).toEqual(["20:00-02:00"]);
    expect(r.bookable).toEqual([]); // 영업 10~20 과 겹치지 않음
    const early: WorkSchedule[] = [{ ...sched[3], startTime: "08:00", endTime: "12:00", breaks: [] }];
    expect(fmt(resolveWorkDay({ ...base, schedules: early, date: THU }).bookable)).toEqual(["10:00-12:00"]);
  });
});
