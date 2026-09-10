import { describe, expect, it } from "vitest";
import { clock, dayText, minsText, monthGrid, monthOf, rangeText, shiftMonth } from "./format";

const TZ = "Asia/Seoul";

describe("표시 문구", () => {
  it("이용 시간", () => {
    expect(minsText(30)).toBe("30분");
    expect(minsText(60)).toBe("1시간");
    expect(minsText(90)).toBe("1시간 30분");
    expect(minsText(240)).toBe("4시간");
  });

  it("날짜는 UTC 로 읽는다 — 로컬 파싱은 기기 시간대에서 하루 밀린다", () => {
    expect(dayText("2026-10-01")).toBe("10월 1일 (목)");
    expect(dayText("2026-01-01")).toBe("1월 1일 (목)");
  });

  it("시각은 손님 기기가 아니라 **가게** 시계로 읽는다", () => {
    // 같은 순간을 서울에서 보면 10:00 이다. 손님이 런던에 있어도 화면에는 가게 시각이 떠야 한다
    expect(clock("2026-10-01T01:00:00Z", TZ)).toBe("10:00");
    expect(clock("2026-10-01T10:00:00+09:00", TZ)).toBe("10:00");
  });

  it("끝이 다음 날이면 익일을 붙인다", () => {
    expect(rangeText("2026-10-01T10:00:00+09:00", "2026-10-01T11:00:00+09:00", TZ)).toBe("10:00 – 11:00");
    expect(rangeText("2026-10-01T23:00:00+09:00", "2026-10-02T01:00:00+09:00", TZ)).toBe("23:00 – 익일 01:00");
  });

  it("달력 격자", () => {
    // 2026-10-01 은 목요일 → 앞에 빈 칸 4개, 31일
    expect(monthGrid("2026-10-01")).toEqual({ lead: 4, days: expect.arrayContaining(["2026-10-01", "2026-10-31"]) });
    expect(monthGrid("2026-10-01").days).toHaveLength(31);
    expect(monthGrid("2026-02-01").days, "평년 2월").toHaveLength(28);
    expect(monthGrid("2028-02-01").days, "윤년 2월").toHaveLength(29);
  });

  it("달 이동은 연도를 넘어간다", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthOf("2026-10-17")).toBe("2026-10-01");
  });
});
