import { describe, expect, it } from "vitest";
import { computeSlots } from "./slots";
import type { SlotContext, SlotQuery, SlotSuccess } from "./slot-types";

/**
 * 픽스처 40건(`tests/fixtures/slot-cases.json`)이 다루지 않는 가장자리 — 잘못된 입력과 깨진 상품 데이터.
 * 픽스처는 "명세를 손으로 계산한 기대값" 이라 건드리지 않고, 방어적 동작은 여기서 본다.
 */

const base: SlotContext = {
  now: "2026-09-30T09:00:00+09:00",
  business: {
    timezone: "Asia/Seoul",
    openingHours: [{ dow: 4, open: "10:00", close: "20:00" }],
    policy: { minLeadTimeMin: 60, maxAdvanceDays: 30 },
  },
  product: {
    id: "prd",
    startMode: "FREE",
    fixedStartTimes: null,
    slotIntervalMin: 60,
    durationMin: 60,
    durationOptions: null,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    capacityPerSlot: 20,
    maxPartySize: 10,
    resourceSelectMode: "NONE",
    resourceIds: ["desk"],
  },
  resources: [{ id: "desk", type: "SHARED", capacity: 20, isActive: true, sortOrder: 1 }],
  workSchedules: [],
  workExceptions: [],
  holidays: [],
  existingReservations: [],
};
const q: SlotQuery = { date: "2026-10-01", partySize: 1 };
const ctxWith = (patch: Partial<SlotContext>): SlotContext => ({ ...base, ...patch });
const ok = (r: ReturnType<typeof computeSlots>) => r as SlotSuccess;

describe("입력 하한", () => {
  it("partySize 0 은 오류다 — 만석 슬롯이 '잔여 0 ≥ 0' 으로 통과하면 안 된다", () => {
    const full = ctxWith({
      existingReservations: [{ id: "r1", resourceId: "desk", occupyRange: { start: "2026-10-01T10:00:00+09:00", end: "2026-10-01T11:00:00+09:00" }, partySize: 20, status: "CONFIRMED" }],
    });
    expect(computeSlots(full, { ...q, partySize: 0 })).toEqual({ error: "PARTY_SIZE_INVALID" });
    expect(computeSlots(full, { ...q, partySize: -1 })).toEqual({ error: "PARTY_SIZE_INVALID" });
    expect(computeSlots(full, { ...q, partySize: 1.5 })).toEqual({ error: "PARTY_SIZE_INVALID" });
    // 정상 인원이면 그 시각만 만석
    expect(ok(computeSlots(full, q)).slots.some((s) => s.start.endsWith("T10:00:00+09:00"))).toBe(false);
  });

  it("이용 시간이 0 이하면 오류다 (버퍼 0 이면 점유 구간이 비어 스윕라인이 던진다)", () => {
    const zero = ctxWith({ product: { ...base.product, durationMin: 0 } });
    expect(computeSlots(zero, q)).toEqual({ error: "DURATION_NOT_ALLOWED" });
  });

  it("FREE 상품에 격자 간격이 없으면 조용히 기본값을 끼우지 않고 던진다 (DB CHECK 가 막는 상태)", () => {
    const broken = ctxWith({ product: { ...base.product, slotIntervalMin: null } });
    expect(() => computeSlots(broken, q)).toThrow(/slotIntervalMin/);
  });
});

describe("FIXED 회차 정규화", () => {
  const midnight = (times: string[]): SlotContext =>
    ctxWith({
      business: { ...base.business, openingHours: [{ dow: 4, open: "20:00", close: "02:00" }] },
      product: { ...base.product, startMode: "FIXED", fixedStartTimes: [{ dow: 4, times }], slotIntervalMin: null, capacityPerSlot: 10 },
      resources: [{ id: "desk", type: "SHARED", capacity: 10, isActive: true, sortOrder: 1 }],
    });

  it("자정 넘김 영업의 이른 회차는 익일이지만, 개장 전 회차는 그날 그대로다", () => {
    const r = ok(computeSlots(midnight(["19:00", "22:00", "01:00"]), q));
    expect(r.slots.map((s) => s.start)).toEqual(["2026-10-01T22:00:00+09:00", "2026-10-02T01:00:00+09:00"]);
    // 19:00 은 개장(20:00) 전 — 익일 19:00 으로 밀리지 않고 그날 19:00 인 채로 구간 밖이다
    expect(r.excluded).toEqual([{ start: "2026-10-01T19:00:00+09:00", end: "2026-10-01T20:00:00+09:00", resourceId: "desk", reason: "OUT_OF_WINDOW" }]);
  });

  it("같은 요일 항목이 여러 개여도 모으고, 같은 시각은 한 번만 센다", () => {
    const dup = ctxWith({
      product: { ...base.product, startMode: "FIXED", slotIntervalMin: null, capacityPerSlot: 10, fixedStartTimes: [{ dow: 4, times: ["11:00", "11:00"] }, { dow: 4, times: ["15:00"] }] },
      resources: [{ id: "desk", type: "SHARED", capacity: 10, isActive: true, sortOrder: 1 }],
    });
    const r = ok(computeSlots(dup, q));
    expect(r.slots.map((s) => s.start)).toEqual(["2026-10-01T11:00:00+09:00", "2026-10-01T15:00:00+09:00"]);
    expect(r.slots[0].remaining).toBe(10);
    expect(r.slots[0].resourceIds).toEqual(["desk"]);
  });
});

describe("빈 결과로 조용히 끝나는 것들", () => {
  it.each([
    ["연결된 자원이 없다", ctxWith({ product: { ...base.product, resourceIds: [] }, resources: [] })],
    ["자원이 전부 비활성", ctxWith({ resources: [{ id: "desk", type: "SHARED", capacity: 20, isActive: false, sortOrder: 1 }] })],
    ["그 요일은 영업하지 않는다", ctxWith({ business: { ...base.business, openingHours: [{ dow: 1, open: "10:00", close: "20:00" }] } })],
    ["FIXED 인데 회차 정의가 없다", ctxWith({ product: { ...base.product, startMode: "FIXED", fixedStartTimes: null, slotIntervalMin: null } })],
  ])("%s", (_name, ctx) => {
    expect(ok(computeSlots(ctx, q)).slots).toEqual([]);
  });
});
