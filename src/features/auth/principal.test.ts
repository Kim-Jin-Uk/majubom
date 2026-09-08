import { describe, expect, it } from "vitest";
import { consoleAccess, type Principal } from "./principal";

const base: Principal = {
  uid: "u",
  name: "n",
  globalRole: "USER",
  userStatus: "ACTIVE",
  totpEnabled: false,
  membership: { memberId: "m", businessId: "b", businessSlug: "s", businessStatus: "APPROVED", role: "OWNER", memberStatus: "ACTIVE", permissions: {}, emailVerified: true },
};

describe("consoleAccess (FR-AUTH-010 · FR-ADM-020)", () => {
  it("PENDING 사업장도 콘솔은 열린다", () => {
    expect(consoleAccess({ ...base, membership: { ...base.membership!, businessStatus: "PENDING" } })).toEqual({ denial: null, readOnly: false });
  });
  it("SUSPENDED 는 읽기 전용, BLOCKED 는 차단", () => {
    expect(consoleAccess({ ...base, membership: { ...base.membership!, businessStatus: "SUSPENDED" } })).toEqual({ denial: null, readOnly: true });
    expect(consoleAccess({ ...base, membership: { ...base.membership!, businessStatus: "BLOCKED" } }).denial).toBe("BUSINESS_BLOCKED");
  });
  it("사업자 이메일 미검증은 콘솔 차단", () => {
    expect(consoleAccess({ ...base, membership: { ...base.membership!, emailVerified: false } }).denial).toBe("EMAIL_UNVERIFIED");
  });
  it("멤버 INVITED/INACTIVE · 사용자 정지 · 무소속", () => {
    expect(consoleAccess({ ...base, membership: { ...base.membership!, memberStatus: "INVITED" } }).denial).toBe("MEMBER_INACTIVE");
    expect(consoleAccess({ ...base, userStatus: "SUSPENDED" }).denial).toBe("USER_INACTIVE");
    expect(consoleAccess({ ...base, membership: null }).denial).toBe("NO_MEMBERSHIP");
  });
});
