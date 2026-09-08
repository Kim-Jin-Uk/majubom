import { describe, expect, it } from "vitest";
import { isPreexistingAccount } from "./business-signup";

describe("isPreexistingAccount — 신청과 함께 만든 계정 vs 기존 고객 계정", () => {
  const biz = new Date("2026-09-08T09:00:00.000Z");
  it("같은 트랜잭션(같은 now) 이면 신청과 함께 만든 계정", () => {
    expect(isPreexistingAccount(new Date(biz), biz)).toBe(false);
    expect(isPreexistingAccount(new Date(biz.getTime() - 500), biz)).toBe(false);
  });
  it("1초 넘게 앞서면 기존 계정 — 정리 배치가 지우지 않는다", () => {
    expect(isPreexistingAccount(new Date(biz.getTime() - 1500), biz)).toBe(true);
    expect(isPreexistingAccount(new Date("2026-01-01"), biz)).toBe(true);
  });
});
