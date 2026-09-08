import { describe, expect, it } from "vitest";
import { countsTowardOccupancy, peakOccupancy } from "./peak-occupancy";

const at = (hm: string, date = "2026-10-01") => `${date}T${hm}:00+09:00`;
const res = (start: string, end: string, partySize: number) => ({
  occupyRange: { start: at(start), end: at(end) },
  partySize,
});

describe("peakOccupancy — 순간 최대 동시 인원 (FR-BOOK-010)", () => {
  it("명세 예시: 20석, 10–11시 10명 + 11–12시 10명일 때 10:30–11:30 5명 요청은 15명으로 성립한다", () => {
    const existing = [res("10:00", "11:00", 10), res("11:00", "12:00", 10)];
    const occupy = { start: at("10:30"), end: at("11:30") };

    // 단순 합산이면 20(만석)이지만 어느 순간에도 동시 인원은 10을 넘지 않는다
    expect(peakOccupancy(occupy, existing)).toBe(10);
    expect(20 - peakOccupancy(occupy, existing)).toBeGreaterThanOrEqual(5);

    // 5명을 더 넣은 뒤의 순간 최대 동시 인원은 15 ≤ 20
    expect(peakOccupancy(occupy, [...existing, res("10:30", "11:30", 5)])).toBe(15);
    // 같은 조건에서 15명 요청은 실패한다 (잔여 10 < 15)
    expect(20 - peakOccupancy(occupy, existing)).toBeLessThan(15);
  });

  it("겹치는 예약이 없으면 0, 반열림 구간이라 끝점이 맞닿는 예약은 겹치지 않는다", () => {
    const occupy = { start: at("11:00"), end: at("12:00") };
    expect(peakOccupancy(occupy, [])).toBe(0);
    // 10:00–11:00 은 11:00 에 끝나고, 12:00–13:00 은 12:00 에 시작 → 둘 다 미겹침
    expect(peakOccupancy(occupy, [res("10:00", "11:00", 7), res("12:00", "13:00", 9)])).toBe(0);
  });

  it("삼중 계단식 겹침에서 최대는 두 예약이 동시에 걸리는 순간(16)이며 합산(24)이 아니다", () => {
    // A 10–12 ×8, B 11–13 ×8, C 12–14 ×8
    const existing = [res("10:00", "12:00", 8), res("11:00", "13:00", 8), res("12:00", "14:00", 8)];
    // [11:30, 12:30): 11:30 에 A+B=16, 12:00 에 B+C=16 (A는 12:00 에 끝남)
    expect(peakOccupancy({ start: at("11:30"), end: at("12:30") }, existing)).toBe(16);
    // [10:00, 11:00): A 만 → 8
    expect(peakOccupancy({ start: at("10:00"), end: at("11:00") }, existing)).toBe(8);
    // [13:00, 14:00): C 만 → 8
    expect(peakOccupancy({ start: at("13:00"), end: at("14:00") }, existing)).toBe(8);
  });

  it("요청 구간보다 먼저 시작한 예약은 occupy.start 지점에서 계산된다 (자정 넘김 포함)", () => {
    // 전날 23:00 에 시작한 240분 예약(23:00–03:00)이 다음 날 00:00–01:00 요청에 반영된다
    const overnight = {
      occupyRange: { start: at("23:00", "2026-10-01"), end: at("03:00", "2026-10-02") },
      partySize: 3,
    };
    const occupy = { start: at("00:00", "2026-10-02"), end: at("01:00", "2026-10-02") };
    expect(peakOccupancy(occupy, [overnight])).toBe(3);
    // 그 안에서 새로 시작하는 예약이 더해지면 그 시작점이 최대가 된다
    expect(
      peakOccupancy(occupy, [
        overnight,
        { occupyRange: { start: at("00:30", "2026-10-02"), end: at("02:00", "2026-10-02") }, partySize: 2 },
      ]),
    ).toBe(5);
  });

  it("정원 1 자원에서는 스윕라인 결과가 기존 겹침 검사와 같다 — 겹치면 1, 아니면 0", () => {
    const one = [res("11:00", "12:30", 1)];
    // 부분 겹침 (10:00–11:30)
    expect(peakOccupancy({ start: at("10:00"), end: at("11:30") }, one)).toBe(1);
    // 완전 포함 (11:30–12:00)
    expect(peakOccupancy({ start: at("11:30"), end: at("12:00") }, one)).toBe(1);
    // 예약이 요청을 완전히 감싸는 경우도 1
    expect(peakOccupancy({ start: at("10:00"), end: at("13:00") }, one)).toBe(1);
    // 맞닿기만 하면 0 → 잔여 1
    expect(peakOccupancy({ start: at("12:30"), end: at("14:00") }, one)).toBe(0);

    // 점유 상태 필터: REQUESTED · CONFIRMED 만 점유로 친다
    expect(countsTowardOccupancy({ status: "REQUESTED" })).toBe(true);
    expect(countsTowardOccupancy({ status: "CONFIRMED" })).toBe(true);
    for (const status of ["COMPLETED", "CANCELED_BY_USER", "CANCELED_BY_BIZ", "NO_SHOW", "REJECTED", "EXPIRED"] as const) {
      expect(countsTowardOccupancy({ status })).toBe(false);
    }
  });
});
