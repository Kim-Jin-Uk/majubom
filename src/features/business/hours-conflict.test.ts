import { describe, expect, it } from "vitest";
import { fitsInHours, outsideHours, type LocalReservation } from "./hours-conflict";

/**
 * 영업시간·상품 시간을 **줄일 때** 밖으로 밀려나는 예약을 찾는 판정 (9/14 결정 — 그런 변경은 막는다).
 *
 * 까다로운 것은 자정을 넘긴 예약이다. 23:00~01:00 예약의 달력 날짜는 시작일이지만,
 * 00:30 에 시작하는 예약은 **전날 영업일**에 속한다(20:00~02:00 영업의 새벽 시각).
 * 한쪽만 보면 멀쩡한 예약이 "밖으로 나갔다" 로 잡혀 사장님이 영영 영업시간을 못 바꾼다.
 */
const MON = "2026-09-14";
const TUE = "2026-09-15";
const DAY = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "19:00" }));
const NIGHT = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "20:00", close: "02:00" }));

const res = (over: Partial<LocalReservation>): LocalReservation => ({
  id: "r",
  code: "C",
  productId: "p",
  startAt: new Date(),
  endAt: new Date(),
  resourceName: "자리",
  customerName: "김고객",
  status: "CONFIRMED",
  startDate: MON,
  endDate: MON,
  startMin: 600,
  endMin: 660,
  ...over,
});

describe("fitsInHours", () => {
  it("구간 안에 온전히 들어가야 한다 — 시작만 보지 않는다", () => {
    expect(fitsInHours(res({ startMin: 600, endMin: 660 }), DAY)).toBe(true);
    // 18:30 시작 60분 → 19:30 종료. 마감 19:00 을 넘는다
    expect(fitsInHours(res({ startMin: 1110, endMin: 1170 }), DAY)).toBe(false);
  });

  it("그 요일이 없으면 밖이다", () => {
    const SAT = "2026-09-19";
    expect(fitsInHours(res({ startDate: SAT, endDate: SAT }), DAY)).toBe(false);
  });

  it("자정을 넘긴 예약은 시작일 구간에서 본다 — 23:00~01:00 은 20:00~02:00 영업 안이다", () => {
    expect(fitsInHours(res({ startDate: MON, endDate: TUE, startMin: 1380, endMin: 60 }), NIGHT)).toBe(true);
  });

  it("새벽 시각은 **전날 영업일**로도 본다 — 00:30 예약이 전날 20:00~02:00 안이면 밖이 아니다", () => {
    // 화요일 00:30~01:30. 화요일 구간(20:00~)만 보면 밖이지만, 월요일 영업이 02:00 까지 이어진다
    expect(fitsInHours(res({ startDate: TUE, endDate: TUE, startMin: 30, endMin: 90 }), NIGHT)).toBe(true);
  });

  it("전날 영업이 자정을 안 넘기면 새벽 예약은 밖이다", () => {
    expect(fitsInHours(res({ startDate: TUE, endDate: TUE, startMin: 30, endMin: 90 }), DAY)).toBe(false);
  });

  it("영업시간을 정하지 않았으면 하루 전체라 무엇도 밖이 아니다 — 비우는 방향은 막히지 않는다", () => {
    expect(fitsInHours(res({ startMin: 30, endMin: 90 }), [])).toBe(true);
    expect(fitsInHours(res({ startMin: 1380, endMin: 1439 }), [])).toBe(true);
  });
});

describe("outsideHours", () => {
  it("상품마다 적용되는 시간이 다를 수 있다", () => {
    const rows = [
      res({ id: "a", productId: "day", startMin: 600, endMin: 660 }),
      res({ id: "b", productId: "night", startMin: 1260, endMin: 1320 }),
    ];
    const hoursFor = (pid: string) => (pid === "night" ? NIGHT : DAY);
    expect(outsideHours(rows, hoursFor)).toEqual([]);
    // 낮 상품 시간을 줄이면 a 만 걸린다
    expect(outsideHours(rows, (pid) => (pid === "night" ? NIGHT : [{ dow: 1, open: "13:00", close: "19:00" }])).map((r) => r.id)).toEqual(["a"]);
  });

  it("걸린 예약의 정보를 그대로 돌려준다 — 사장님이 무엇을 정리해야 할지 알아야 한다", () => {
    const [hit] = outsideHours([res({ id: "x", code: "ABC123", startMin: 1110, endMin: 1170 })], () => DAY);
    expect(hit).toMatchObject({ id: "x", code: "ABC123", customerName: "김고객", resourceName: "자리" });
  });
});
