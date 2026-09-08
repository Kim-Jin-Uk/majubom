import { describe, expect, it } from "vitest";
import { guessPreset, PRESETS } from "./presets";
import { fixedTimeWarnings, longestOpenSpanMin } from "./products";

describe("longestOpenSpanMin", () => {
  it("가장 긴 영업일 기준, 익일 마감은 +24h, 영업시간 없으면 null", () => {
    expect(longestOpenSpanMin([])).toBeNull();
    expect(longestOpenSpanMin([{ dow: 1, open: "10:00", close: "20:00" }, { dow: 5, open: "20:00", close: "04:00" }])).toBe(600);
    expect(longestOpenSpanMin([{ dow: 1, open: "09:00", close: "09:00" }])).toBe(1440);
  });
});

describe("fixedTimeWarnings (고정 회차 vs 영업시간, 브레이크 무시)", () => {
  const hours = [{ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "13:00", end: "14:00" }] }, { dow: 5, open: "20:00", close: "02:00" }];
  it("회차 전체가 영업 구간 안이면 경고 없음 — 브레이크와 겹쳐도 OK", () => {
    expect(fixedTimeWarnings([{ dow: 1, times: ["10:00", "13:00", "19:00"] }], hours, 60)).toEqual([]);
  });
  it("끝이 마감을 넘거나 시작이 이르면 OUTSIDE_HOURS, 휴무 요일은 CLOSED_DAY", () => {
    expect(fixedTimeWarnings([{ dow: 1, times: ["19:30"] }], hours, 60)).toEqual([{ dow: 1, time: "19:30", reason: "OUTSIDE_HOURS" }]);
    expect(fixedTimeWarnings([{ dow: 1, times: ["09:00"] }], hours, 60)[0].reason).toBe("OUTSIDE_HOURS");
    expect(fixedTimeWarnings([{ dow: 2, times: ["10:00"] }], hours, 60)[0].reason).toBe("CLOSED_DAY");
  });
  it("심야 영업: 자정 넘긴 회차(01:00)는 안, 01:30+60 은 밖", () => {
    expect(fixedTimeWarnings([{ dow: 5, times: ["01:00"] }], hours, 60)).toEqual([]);
    expect(fixedTimeWarnings([{ dow: 5, times: ["01:30"] }], hours, 60)[0].reason).toBe("OUTSIDE_HOURS");
  });
});

describe("presets", () => {
  it("명세 매핑: 담당자형 FREE/30/없음/1/1/OPTIONAL · 공간형 60·120·240/REQUIRED · 수업형 FIXED/NONE", () => {
    const [staff, space, cls] = PRESETS.map((p) => p.values);
    expect([staff.startMode, staff.slotIntervalMin, staff.durationOptions, staff.capacityPerSlot, staff.maxPartySize, staff.resourceSelectMode]).toEqual(["FREE", 30, null, 1, 1, "OPTIONAL"]);
    expect([space.durationOptions, space.maxPartySize, space.resourceSelectMode]).toEqual([[60, 120, 240], 4, "REQUIRED"]);
    expect([cls.startMode, cls.durationOptions, cls.capacityPerSlot, cls.resourceSelectMode]).toEqual(["FIXED", null, null, "NONE"]);
  });
  it("guessPreset 은 저장된 상품을 가장 가까운 카드에 붙인다", () => {
    expect(guessPreset({ startMode: "FIXED", durationOptions: null, capacityPerSlot: 10 })).toBe("class");
    expect(guessPreset({ startMode: "FREE", durationOptions: [60, 120], capacityPerSlot: 1 })).toBe("space");
    expect(guessPreset({ startMode: "FREE", durationOptions: null, capacityPerSlot: 1 })).toBe("staff");
  });
});
