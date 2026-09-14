import { describe, expect, it } from "vitest";
import { openingWindows, operatingWindows } from "./operating";
import type { Dow, WorkSchedule } from "@/features/booking/slot-types";
import { resolveWorkDay } from "./resolve";

/**
 * **"정하지 않음" 과 "그날은 쉼" 은 다르다** (9/14 결정).
 *
 * 둘을 같은 빈 구간으로 접으면 영업시간이나 근무표를 아직 안 짠 매장이 예약을 하나도 받지 못한다.
 * 반대로 둘을 같은 "전일 열림" 으로 접으면 월~금만 적은 매장의 토요일이 열린다. 그 경계가 이 파일의 전부다.
 */
const MON = "2026-09-14"; // 월
const SAT = "2026-09-19"; // 토
const WHOLE = [{ start: 0, end: 1440 }];
const RES = { id: "r1", type: "STAFF" as const };
const EMPTY = { schedules: [], exceptions: [], holidays: [] };

describe("영업시간을 정하지 않았을 때", () => {
  it("항목이 통째로 비면 하루 전체가 열린다", () => {
    expect(openingWindows([], MON, true)).toEqual(WHOLE);
    expect(openingWindows([], SAT, true)).toEqual(WHOLE);
  });

  it("월~금만 적었으면 토요일은 여전히 휴무다 — 안 적은 요일까지 열지 않는다", () => {
    const weekdays = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "19:00" }));
    expect(openingWindows(weekdays, MON, true)).toEqual([{ start: 600, end: 1140 }]);
    expect(openingWindows(weekdays, SAT, true)).toEqual([]);
  });
});

describe("근무표를 짜지 않았을 때", () => {
  it("그 담당자에게 근무표가 하나도 없으면 하루 전체가 바탕이다", () => {
    const day = resolveWorkDay({ date: MON, resourceId: "r1", openingHours: [], ...EMPTY });
    expect(day.work).toEqual(WHOLE);
    expect(day.source).toBe("UNSET");
  });

  it("근무표는 있는데 그 요일이 없으면 그날은 쉰다", () => {
    const schedules: WorkSchedule[] = [{ resourceId: "r1", dayOfWeek: 1 as Dow, startTime: "10:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01", effectiveTo: null }];
    expect(resolveWorkDay({ date: MON, resourceId: "r1", openingHours: [], ...EMPTY, schedules }).source).toBe("SCHEDULE");
    const sat = resolveWorkDay({ date: SAT, resourceId: "r1", openingHours: [], ...EMPTY, schedules });
    expect(sat.work).toEqual([]);
    expect(sat.source).toBe("NONE");
  });

  it("다른 자원의 근무표는 내 판정에 끼어들지 않는다", () => {
    const schedules: WorkSchedule[] = [{ resourceId: "OTHER", dayOfWeek: 1 as Dow, startTime: "10:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01", effectiveTo: null }];
    expect(resolveWorkDay({ date: MON, resourceId: "r1", openingHours: [], ...EMPTY, schedules }).source).toBe("UNSET");
  });
});

describe("콘솔 지표도 같은 답을 낸다", () => {
  it("영업시간 미정이면 근무표 화면에서도 휴무가 아니다 — 슬롯만 열리고 지표가 닫히면 안 된다", () => {
    const day = resolveWorkDay({ date: MON, resourceId: "r1", openingHours: [], ...EMPTY });
    expect(day.closed, "미정은 휴무가 아니다").toBe(false);
    expect(day.bookable, "예약 가능 구간도 하루 전체").toEqual(WHOLE);
  });

  it("월~금만 적었으면 토요일은 근무표에서도 휴무다", () => {
    const weekdays = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "19:00" }));
    const sat = resolveWorkDay({ date: SAT, resourceId: "r1", openingHours: weekdays, ...EMPTY });
    expect(sat.closed).toBe(true);
    expect(sat.bookable).toEqual([]);
  });
});

describe("둘 다 비었을 때 — 0~24시가 전부 열린다", () => {
  it("담당자 자원", () => {
    const opening = openingWindows([], MON, true);
    expect(operatingWindows({ date: MON, resource: RES, opening, openingHours: [], ...EMPTY })).toEqual(WHOLE);
  });

  it("공간 자원 — 근무표가 없는 종류라 영업시간만 본다", () => {
    const opening = openingWindows([], MON, true);
    expect(operatingWindows({ date: MON, resource: { id: "sp", type: "SPACE" }, opening, openingHours: [], ...EMPTY })).toEqual(WHOLE);
  });

  it("휴무·개인 차단은 그대로 깎는다 — 전일 열림이 방어를 무르게 하지 않는다", () => {
    const opening = openingWindows([], MON, true);
    const blocked = operatingWindows({
      date: MON,
      resource: RES,
      opening,
      openingHours: [],
      schedules: [],
      exceptions: [{ resourceId: "r1", date: MON, kind: "BLOCK" as const, startTime: "12:00", endTime: "13:00" }],
      holidays: [],
    });
    expect(blocked).toEqual([
      { start: 0, end: 720 },
      { start: 780, end: 1440 },
    ]);
  });
});
