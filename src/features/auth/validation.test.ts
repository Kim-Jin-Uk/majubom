import { describe, expect, it } from "vitest";
import { bizRegNoSchema, emailSchema, passwordSchema, phoneSchema, validBizRegNo } from "./validation";

describe("passwordSchema (FR-AUTH-010)", () => {
  it("8자 이상 영문+숫자", () => {
    expect(passwordSchema.safeParse("abcd1234").success).toBe(true);
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
    expect(passwordSchema.safeParse("ab12").success).toBe(false);
  });
});

describe("bizRegNo", () => {
  it("체크섬 — 유효/무효", () => {
    // 국세청 예시 형식: 마지막 자리 체크섬. 220-81-62517 은 공개된 유효 번호 형식 예 (검증 알고리즘 기준)
    expect(validBizRegNo("2208162517")).toBe(true);
    expect(validBizRegNo("2208162518")).toBe(false);
    expect(validBizRegNo("123456789")).toBe(false);
  });
  it("하이픈 제거해 저장", () => {
    const r = bizRegNoSchema.safeParse("220-81-62517");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("2208162517");
  });
});

describe("email · phone", () => {
  it("이메일 소문자 정규화", () => {
    const r = emailSchema.safeParse("  Kim@Example.COM ");
    expect(r.success && r.data).toBe("kim@example.com");
  });
  it("전화번호 하이픈·공백 제거", () => {
    const r = phoneSchema.safeParse("010-1234 5678");
    expect(r.success && r.data).toBe("01012345678");
    expect(phoneSchema.safeParse("1234").success).toBe(false);
  });
});
