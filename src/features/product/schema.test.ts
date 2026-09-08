import { describe, expect, it } from "vitest";
import { normalizeFixedStartTimes, productInputSchema } from "./schema";

const base = { name: "젤네일", startMode: "FREE", slotIntervalMin: 30, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceIds: ["6d0f2f5e-3c7e-4c3a-9d5d-2b3b1f8a0c11"], resourceSelectMode: "OPTIONAL" };

describe("productInputSchema (FR-PRD-010 세 스위치)", () => {
  it("담당자형 기본은 통과, 기본값(images·버퍼·status) 채움", () => {
    const r = productInputSchema.parse(base);
    expect(r.images).toEqual([]);
    expect(r.status).toBe("DRAFT");
    expect(r.bufferAfterMin).toBe(0);
  });
  it("FREE 는 슬롯 간격 필수, 허용값 밖은 거절", () => {
    expect(productInputSchema.safeParse({ ...base, slotIntervalMin: null }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, slotIntervalMin: 25 }).success).toBe(false);
  });
  it("이용 시간 옵션이 있으면 기본 소요 시간은 그 중 하나 · 중복 불가 · 최대 6개", () => {
    expect(productInputSchema.safeParse({ ...base, durationOptions: [60, 120, 240] }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, durationOptions: [90, 120] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, durationOptions: [60, 60] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, durationOptions: [5, 10, 15, 20, 25, 30, 60] }).success).toBe(false);
  });
  it("FIXED 는 회차 시각 필수, 이용 시간 옵션 불가", () => {
    const fixed = { ...base, startMode: "FIXED", slotIntervalMin: null, fixedStartTimes: [{ dow: 1, times: ["10:00", "13:00"] }] };
    expect(productInputSchema.safeParse(fixed).success).toBe(true);
    expect(productInputSchema.safeParse({ ...fixed, fixedStartTimes: [] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...fixed, durationOptions: [60, 120] }).success).toBe(false);
  });
  it("회차 간격이 소요 시간+버퍼보다 짧으면 거절 (회차 겹침)", () => {
    const fixed = { ...base, startMode: "FIXED", slotIntervalMin: null, durationMin: 60, bufferAfterMin: 15 };
    expect(productInputSchema.safeParse({ ...fixed, fixedStartTimes: [{ dow: 1, times: ["10:00", "11:15"] }] }).success).toBe(true);
    const r = productInputSchema.safeParse({ ...fixed, fixedStartTimes: [{ dow: 1, times: ["10:00", "11:00"] }] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("월요일 회차 간격이 소요 시간+버퍼(75분)");
    expect(productInputSchema.safeParse({ ...fixed, fixedStartTimes: [{ dow: 1, times: Array.from({ length: 13 }, (_, i) => `${String(i + 8).padStart(2, "0")}:00`) }] }).success).toBe(false);
  });
  it("소요 시간은 5분 단위 5~480, 1건 인원은 정원 이하, 상품명 40자, 사진 5장 http(s)", () => {
    expect(productInputSchema.safeParse({ ...base, durationMin: 62 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, durationMin: 485 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, capacityPerSlot: 2, maxPartySize: 3 }).success).toBe(false);
    // 정원 1 은 팀 단위 — 공간형 프리셋(정원 1 · 최대 4명) 이 통과해야 한다
    expect(productInputSchema.safeParse({ ...base, capacityPerSlot: 1, maxPartySize: 4 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, name: "가".repeat(41) }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, images: Array(6).fill("https://x/a.jpg") }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, images: ["javascript:alert(1)"] }).success).toBe(false);
  });
});

describe("normalizeFixedStartTimes", () => {
  it("요일·시각 정렬, 중복 제거", () => {
    expect(normalizeFixedStartTimes([{ dow: 3, times: ["13:00", "10:00", "10:00"] }, { dow: 1, times: ["09:30"] }])).toEqual([
      { dow: 1, times: ["09:30"] },
      { dow: 3, times: ["10:00", "13:00"] },
    ]);
  });
});
