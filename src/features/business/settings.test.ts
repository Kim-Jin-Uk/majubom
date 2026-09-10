import { describe, expect, it } from "vitest";
import { openingHourSchema, openingHoursSchema, sameOpeningHours, slugSchema } from "./settings";

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

describe("businessInfoSchema 보강 (리뷰 반영)", () => {
  it("임시 주소 접두어 b- 는 고를 수 없다", () => {
    expect(slugSchema.safeParse("b-salon").success).toBe(false);
  });
  it("timezone 은 IANA 이름만", async () => {
    const { businessInfoSchema } = await import("./settings");
    const base = { name: "봄", category: "hair", openingHours: [] };
    expect(businessInfoSchema.safeParse({ ...base, timezone: "Asia/Seoul" }).success).toBe(true);
    expect(businessInfoSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(businessInfoSchema.safeParse({ ...base }).data?.timezone).toBe("Asia/Seoul");
  });
  it("전화는 가입과 같은 규칙(숫자만 저장)", async () => {
    const { businessInfoSchema } = await import("./settings");
    const base = { name: "봄", category: "hair", openingHours: [] };
    expect(businessInfoSchema.safeParse({ ...base, phone: "02-333-4444" }).data?.phone).toBe("023334444");
    expect(businessInfoSchema.safeParse({ ...base, phone: "12345" }).success).toBe(false);
  });
});

describe("isInfoComplete (1단계 완료 판정)", () => {
  it("상호·전화·주소·영업시간 1일·임시 아닌 slug 가 모두 있어야 한다", async () => {
    const { isInfoComplete } = await import("./settings");
    const ok = { name: "봄", phone: "0233334444", address: "서울", openingHours: [{ dow: 1, open: "10:00", close: "20:00" }], slug: "bom" };
    expect(isInfoComplete(ok)).toBe(true);
    expect(isInfoComplete({ ...ok, phone: null })).toBe(false);
    expect(isInfoComplete({ ...ok, address: null })).toBe(false);
    expect(isInfoComplete({ ...ok, openingHours: [] })).toBe(false);
    expect(isInfoComplete({ ...ok, slug: "b-abc12345" })).toBe(false);
  });
});

describe("openingHourSchema 자정 넘김", () => {
  it("영업 20:00~04:00 에서 01:00~02:00 휴게는 안, 05:00~06:00 은 밖", () => {
    expect(openingHourSchema.safeParse({ dow: 6, open: "20:00", close: "04:00", breaks: [{ start: "01:00", end: "02:00" }] }).success).toBe(true);
    expect(openingHourSchema.safeParse({ dow: 6, open: "20:00", close: "04:00", breaks: [{ start: "05:00", end: "06:00" }] }).success).toBe(false);
    // 마감에 딱 붙는 휴게는 허용
    expect(openingHourSchema.safeParse({ dow: 1, open: "10:00", close: "20:00", breaks: [{ start: "19:00", end: "20:00" }] }).success).toBe(true);
  });
});

describe("sameOpeningHours — 감사 diff 의 '안 바뀌었다' 판정 (#56)", () => {
  const mon = { dow: 1, open: "10:00", close: "20:00" };
  const tue = { dow: 2, open: "10:00", close: "20:00" };

  it("키 순서가 달라도 같다 — jsonb 는 키 순서를 보존하지 않는다", () => {
    // Postgres 는 jsonb 를 길이·바이트 순으로 다시 쓴다. 직렬화 비교였다면 여기서 "변경됨" 이 됐다
    const stored = [{ close: "20:00", dow: 1, open: "10:00" }] as never;
    expect(sameOpeningHours(stored, [mon])).toBe(true);
  });

  it("요일 순서와 브레이크 순서는 뜻이 없다", () => {
    expect(sameOpeningHours([tue, mon], [mon, tue])).toBe(true);
    const twoBreaks = (order: 0 | 1) => [{ ...mon, breaks: order === 0 ? [{ start: "13:00", end: "14:00" }, { start: "17:00", end: "17:30" }] : [{ start: "17:00", end: "17:30" }, { start: "13:00", end: "14:00" }] }];
    expect(sameOpeningHours(twoBreaks(0), twoBreaks(1))).toBe(true);
  });

  it("브레이크 없음과 빈 배열은 같다", () => {
    expect(sameOpeningHours([mon], [{ ...mon, breaks: [] }])).toBe(true);
    expect(sameOpeningHours(null, [])).toBe(true);
  });

  it("실제로 달라지면 다르다", () => {
    expect(sameOpeningHours([mon], [{ ...mon, close: "21:00" }]), "마감 시각").toBe(false);
    expect(sameOpeningHours([mon], [mon, tue]), "요일 추가").toBe(false);
    expect(sameOpeningHours([mon], [{ ...mon, breaks: [{ start: "13:00", end: "14:00" }] }]), "브레이크 추가").toBe(false);
    expect(sameOpeningHours([{ ...mon, breaks: [{ start: "13:00", end: "14:00" }] }], [{ ...mon, breaks: [{ start: "13:00", end: "14:30" }] }]), "브레이크 길이").toBe(false);
  });
});
