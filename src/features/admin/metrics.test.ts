import { describe, expect, it } from "vitest";
import { dayKeys, fillDaily, kstDayStart, rate } from "./metrics";

/**
 * 지표에서 사람을 속이기 쉬운 세 곳 — **표본 없는 비율**, **빈 날**, **날짜 경계**.
 */
describe("rate", () => {
  it("표본이 없으면 0% 가 아니라 모름이다", () => {
    // 0% 로 그리면 "아무도 취소하지 않았다" 로 읽힌다 — 실제로는 예약 자체가 없었다
    expect(rate(0, 0)).toBeNull();
  });

  it("표본이 있으면 비율을 낸다", () => {
    expect(rate(3, 4)).toBe(0.75);
    expect(rate(0, 4)).toBe(0);
  });
});

describe("dayKeys · fillDaily", () => {
  it("오래된 날부터 오늘까지 이어진다", () => {
    expect(dayKeys("2026-09-14", 3)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
  });

  it("예약이 없던 날도 0 으로 남는다", () => {
    // 없는 날을 빼면 그래프가 날짜를 건너뛰며 그려져 조용한 날이 사라지고 기울기가 가팔라진다
    const keys = dayKeys("2026-09-14", 3);
    expect(fillDaily([{ date: "2026-09-13", count: 5 }], keys)).toEqual([
      { date: "2026-09-12", count: 0 },
      { date: "2026-09-13", count: 5 },
      { date: "2026-09-14", count: 0 },
    ]);
  });

  it("집계에 없는 날짜는 무시한다", () => {
    expect(fillDaily([{ date: "2026-01-01", count: 9 }], dayKeys("2026-09-14", 1))).toEqual([{ date: "2026-09-14", count: 0 }]);
  });
});

describe("kstDayStart", () => {
  it("UTC 자정이 아니라 KST 자정이다", () => {
    // UTC 로 자르면 매일 오전 9시 이전 기록이 전날로 잡힌다
    expect(kstDayStart("2026-09-14").toISOString()).toBe("2026-09-13T15:00:00.000Z");
  });
});
