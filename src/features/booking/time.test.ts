import { describe, expect, it } from "vitest";
import { formatInstant, localToInstant } from "./time";

/**
 * 슬롯 계산의 시간 변환. 픽스처 40건은 전부 Asia/Seoul(오프셋 고정)이라 여기서 DST 가 있는 타임존을 따로 본다 —
 * 벽시계 해석("다음 날 01:00")과 경과시간 해석("25시간 뒤")이 갈리는 곳이 서머타임 경계다.
 */

const KST = "Asia/Seoul";

describe("localToInstant · formatInstant (Asia/Seoul)", () => {
  it("영업일 00:00 기준 분을 순간으로 옮긴다", () => {
    expect(formatInstant(localToInstant("2026-10-01", 600, KST), KST)).toBe("2026-10-01T10:00:00+09:00");
    expect(formatInstant(localToInstant("2026-10-01", 0, KST), KST)).toBe("2026-10-01T00:00:00+09:00");
  });

  it("1440 이상이면 날짜를 넘긴다 — 자정 넘긴 영업일", () => {
    expect(formatInstant(localToInstant("2026-10-06", 1500, KST), KST)).toBe("2026-10-07T01:00:00+09:00");
    expect(formatInstant(localToInstant("2026-10-06", 1440, KST), KST)).toBe("2026-10-07T00:00:00+09:00");
    expect(formatInstant(localToInstant("2026-10-06", 1560, KST), KST)).toBe("2026-10-07T02:00:00+09:00");
  });

  it("월·연을 넘겨도 맞다", () => {
    expect(formatInstant(localToInstant("2026-10-31", 1500, KST), KST)).toBe("2026-11-01T01:00:00+09:00");
    expect(formatInstant(localToInstant("2026-12-31", 1500, KST), KST)).toBe("2027-01-01T01:00:00+09:00");
  });

});

describe("서머타임 (America/New_York)", () => {
  const NY = "America/New_York";

  it("여름·겨울 오프셋을 각각 붙인다", () => {
    expect(formatInstant(localToInstant("2026-07-01", 600, NY), NY)).toBe("2026-07-01T10:00:00-04:00");
    expect(formatInstant(localToInstant("2026-01-15", 600, NY), NY)).toBe("2026-01-15T10:00:00-05:00");
  });

  it("시계가 앞으로 가는 날에도 벽시계 시각을 지킨다 (2026-03-08 02:00 → 03:00)", () => {
    // 전날 22:00 에서 다섯 시간 뒤는 벽시계로 익일 03:00 — 경과시간으로는 네 시간이다
    expect(formatInstant(localToInstant("2026-03-07", 1620, NY), NY)).toBe("2026-03-08T03:00:00-04:00");
    // 존재하지 않는 02:30 은 건너뛴 뒤(03:30)로 정규화된다 — 던지지 않는다
    expect(formatInstant(localToInstant("2026-03-08", 150, NY), NY)).toBe("2026-03-08T03:30:00-04:00");
  });

  it("시계가 뒤로 가는 날 (2026-11-01 02:00 → 01:00)", () => {
    expect(formatInstant(localToInstant("2026-11-01", 60, NY), NY)).toBe("2026-11-01T01:00:00-04:00");
    expect(formatInstant(localToInstant("2026-11-01", 180, NY), NY)).toBe("2026-11-01T03:00:00-05:00");
  });
});
