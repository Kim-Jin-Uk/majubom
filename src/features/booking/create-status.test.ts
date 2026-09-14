import { describe, expect, it } from "vitest";
import { isUnconstrained } from "./create";

/**
 * 자동 확정을 쓸 수 있는가 — **"언제 사람이 있다" 고 누가 말했는가**로 정한다 (9/14).
 *
 * 아무도 말하지 않았으면 하루 전체가 열려 있다는 뜻이라, 매장이 한 건씩 보고 확정해야 한다.
 * 처음 구현은 영업시간을 먼저 보고 빠져나가서, 정작 막으려던 "영업시간은 정했지만 근무표가 없는 담당자" 를
 * 통째로 건너뛰었다 (리뷰 지적). 그 경계가 이 파일의 전부다.
 */
describe("isUnconstrained", () => {
  describe("담당자(STAFF) — 근무표가 그 선언이다", () => {
    it("근무표가 없으면 영업시간이 있어도 제약 없음이다", () => {
      // 영업시간은 "가게가 열려 있다" 지 "이 사람이 출근한다" 가 아니다
      expect(isUnconstrained({ businessHoursSet: true, productHoursSet: false, resourceType: "STAFF", hasWorkSchedule: false })).toBe(true);
      expect(isUnconstrained({ businessHoursSet: false, productHoursSet: false, resourceType: "STAFF", hasWorkSchedule: false })).toBe(true);
    });

    it("근무표가 있으면 영업시간이 없어도 제약이 있다 — 그 사람이 언제 있는지 말했다", () => {
      expect(isUnconstrained({ businessHoursSet: false, productHoursSet: false, resourceType: "STAFF", hasWorkSchedule: true })).toBe(false);
      expect(isUnconstrained({ businessHoursSet: true, productHoursSet: false, resourceType: "STAFF", hasWorkSchedule: true })).toBe(false);
    });
  });

  describe("룸·공용 — 사람이 없으므로 영업시간이 곧 이용 가능 시간이다", () => {
    it("영업시간이 있으면 제약이 있다", () => {
      for (const t of ["SPACE", "SHARED"] as const) {
        expect(isUnconstrained({ businessHoursSet: true, productHoursSet: false, resourceType: t, hasWorkSchedule: false }), t).toBe(false);
      }
    });

    it("영업시간이 없으면 제약 없음이다", () => {
      for (const t of ["SPACE", "SHARED"] as const) {
        expect(isUnconstrained({ businessHoursSet: false, productHoursSet: false, resourceType: t, hasWorkSchedule: false }), t).toBe(true);
      }
    });
  });

  it("상품에 시간이 있으면 룸·공용은 영업시간이 없어도 제약이 있다", () => {
    // 상품 시간이 사업장 영업시간을 대신하므로 범위가 정해져 있다
    expect(isUnconstrained({ businessHoursSet: false, productHoursSet: true, resourceType: "SPACE", hasWorkSchedule: false })).toBe(false);
    // 담당자는 다르다 — 상품이 20~22시에 열려도 "그 사람이 그때 있다" 는 말은 아니다
    expect(isUnconstrained({ businessHoursSet: false, productHoursSet: true, resourceType: "STAFF", hasWorkSchedule: false })).toBe(true);
  });

  it("자원을 못 찾으면 영업시간으로 판단한다 — 담당자가 아닌 것과 같게 본다", () => {
    expect(isUnconstrained({ businessHoursSet: true, productHoursSet: false, resourceType: undefined, hasWorkSchedule: false })).toBe(false);
    expect(isUnconstrained({ businessHoursSet: false, productHoursSet: false, resourceType: undefined, hasWorkSchedule: false })).toBe(true);
  });
});
