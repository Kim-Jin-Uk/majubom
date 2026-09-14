import { describe, expect, it } from "vitest";
import { effectiveOpeningHours, productWindows } from "./resolve";

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

/**
 * 자정을 넘겨 여는 심야 상품의 "어제" 판정 — 이 기능의 대표 예시에서 바로 터졌던 자리다 (리뷰 지적).
 *
 * 날짜 범위 판정(`dateInRange`/`stillRunning`)이 사업장 영업시간만 보면, 20:00~02:00 클래스를
 * 00:30 에 조회할 때 그 영업일이 "어제" 로 걸러져 **예약이 아예 안 된다.**
 * 판정의 입력을 고르는 것이 `effectiveOpeningHours` 다 — 여기서 상품 시간이 이기는지 본다.
 */
describe("effectiveOpeningHours", () => {
  const BIZ_DAY = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "19:00" }));
  const NIGHT_CLASS = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "20:00", close: "02:00" }));

  it("상품 시간이 있으면 그것을 쓴다 — 자정 넘김 여부가 상품 기준으로 판정된다", () => {
    expect(effectiveOpeningHours(NIGHT_CLASS, BIZ_DAY)).toBe(NIGHT_CLASS);
  });

  it("비어 있으면 사업장 것을 쓴다", () => {
    expect(effectiveOpeningHours([], BIZ_DAY)).toBe(BIZ_DAY);
    expect(effectiveOpeningHours(undefined, BIZ_DAY)).toBe(BIZ_DAY);
  });

  it("`productWindows` 와 같은 것을 고른다 — 구간과 원본이 다른 기준을 보면 안 된다", () => {
    const cases: Array<[typeof BIZ_DAY, typeof BIZ_DAY]> = [
      [NIGHT_CLASS, BIZ_DAY],
      [[], BIZ_DAY],
      [[], []],
    ];
    for (const [prod, biz] of cases) {
      const picked = effectiveOpeningHours(prod, biz);
      expect(productWindows(prod, biz, MON, true)).toEqual(productWindows(picked, [], MON, true));
    }
  });
});
