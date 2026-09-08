import { describe, expect, it } from "vitest";
import { maskEmail, normalizePermissions } from "./members";

describe("members helpers", () => {
  it("이메일 마스킹 — 앞 2자만", () => {
    expect(maskEmail("manager@example.com")).toBe("ma*****@example.com");
    expect(maskEmail("a@x.io")).toBe("a*@x.io");
    expect(maskEmail("broken")).toBe("***");
  });
  it("권한은 알려진 4키만, true 만 저장", () => {
    expect(normalizePermissions({ editProduct: true, handleChat: false, admin: true, replyReview: "yes" })).toEqual({ editProduct: true });
    expect(normalizePermissions(undefined)).toEqual({});
  });
});
