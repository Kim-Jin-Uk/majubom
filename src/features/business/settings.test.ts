import { describe, expect, it } from "vitest";
import { openingHourSchema, openingHoursSchema, slugSchema } from "./settings";

describe("openingHourSchema (#26 영업시간 규칙)", () => {
  it("일반 영업시간 + 휴게 1구간", () => {
    expect(openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "13:00", end: "14:00" }] }).success).toBe(true);
  });
  it("close ≤ open 은 익일 마감으로 본다 (심야 영업)", () => {
    expect(openingHourSchema.safeParse({ dow: 5, open: "20:00", close: "04:00" }).success).toBe(true);
    // 자정 넘긴 휴게도 영업시간 안이면 OK
    expect(openingHourSchema.safeParse({ dow: 5, open: "20:00", close: "04:00", breaks: [{ start: "01:00", end: "02:00" }] }).success).toBe(true);
  });
  it("휴게가 영업시간 밖이면 거절", () => {
    const r = openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "09:00", end: "10:30" }] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("영업시간 안에");
  });
  it("휴게 2구간이 겹치면 거절, 3구간은 거절", () => {
    expect(openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "12:00", end: "14:00" }, { start: "13:00", end: "15:00" }] }).success).toBe(false);
    expect(openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "11:00", end: "11:30" }, { start: "12:00", end: "12:30" }, { start: "13:00", end: "13:30" }] }).success).toBe(false);
  });
  it("HH:MM 형식이 아니면 거절", () => {
    expect(openingHourSchema.safeParse({ dow: 1, open: "9:00", close: "20:00" }).success).toBe(false);
    expect(openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "24:00" }).success).toBe(false);
  });
  it("같은 요일이 두 번 들어오면 거절", () => {
    expect(openingHoursSchema.safeParse([{ dow: 1, open: "10:00", close: "20:00" }, { dow: 1, open: "10:00", close: "18:00" }]).success).toBe(false);
    expect(openingHoursSchema.safeParse([]).success).toBe(true);
  });
});

describe("slugSchema", () => {
  it("영소문자·숫자·하이픈 3~30자, 대문자는 소문자로", () => {
    expect(slugSchema.parse(" My-Salon ")).toBe("my-salon");
    expect(slugSchema.safeParse("ab").success).toBe(false);
    expect(slugSchema.safeParse("-abc").success).toBe(false);
    expect(slugSchema.safeParse("abc-").success).toBe(false);
    expect(slugSchema.safeParse("한글").success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(31)).success).toBe(false);
  });
});
