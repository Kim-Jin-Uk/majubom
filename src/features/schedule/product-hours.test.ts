import { describe, expect, it } from "vitest";
import { productWindows } from "./resolve";

/**
 * 상품 시간은 사업장 영업시간을 **대신한다** — 교집합이 아니다 (9/14 결정).
 *
 * 교집합으로 두면 "영업 10–19, 클래스 20–22" 같은 상품을 아예 만들 수 없다(빈 구간이 된다).
 * 영업시간과 맞추고 싶은 사장님은 화면의 "영업시간과 동일" 토글을 켜 두면 되고, 그때는 값을 저장하지 않아
 * 영업시간이 바뀌면 같이 바뀐다. 그 연동이 **빈 배열**로 표현된다는 것이 이 파일의 핵심이다.
 */
const MON = "2026-09-14"; // 월
const SAT = "2026-09-19"; // 토
const BIZ = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "19:00" }));
const NIGHT = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "20:00", close: "22:00" }));

describe("productWindows", () => {
  it("상품 시간이 비면 사업장 영업시간을 따른다 — 이것이 '영업시간과 동일' 이다", () => {
    expect(productWindows([], BIZ, MON, true)).toEqual([{ start: 600, end: 1140 }]);
    expect(productWindows(undefined, BIZ, MON, true)).toEqual([{ start: 600, end: 1140 }]);
  });

  it("상품 시간이 있으면 그것이 영업시간을 대신한다 — 영업시간 밖도 열린다", () => {
    // 교집합이었다면 빈 구간이 된다. 심야 클래스를 만들 수 없다는 뜻이다
    expect(productWindows(NIGHT, BIZ, MON, true)).toEqual([{ start: 1200, end: 1320 }]);
  });

  it("상품 시간에 없는 요일은 그 상품이 쉰다 — 사업장이 열어도 열리지 않는다", () => {
    const monOnly = [{ dow: 1, open: "10:00", close: "12:00" }];
    const bizAllWeek = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "09:00", close: "21:00" }));
    expect(productWindows(monOnly, bizAllWeek, MON, true)).toEqual([{ start: 600, end: 720 }]);
    expect(productWindows(monOnly, bizAllWeek, SAT, true)).toEqual([]);
  });

  it("둘 다 비면 하루 전체 — 새로 만들 수는 없지만(상품 시간 필수) 옛 데이터가 여기로 떨어진다", () => {
    expect(productWindows([], [], MON, true)).toEqual([{ start: 0, end: 1440 }]);
  });

  it("휴게는 상품 시간의 것을 뺀다. FIXED 는 빼지 않는다 (가정 A4)", () => {
    const withBreak = [{ dow: 1, open: "10:00", close: "18:00", breaks: [{ start: "13:00", end: "14:00" }] }];
    expect(productWindows(withBreak, BIZ, MON, true)).toEqual([
      { start: 600, end: 780 },
      { start: 840, end: 1080 },
    ]);
    expect(productWindows(withBreak, BIZ, MON, false)).toEqual([{ start: 600, end: 1080 }]);
  });
});
