import { describe, expect, it } from "vitest";
import { defaultsFor, isInAppLocked, preferenceInputSchema, visibleGroups } from "./notification-rules";
import { profileInputSchema } from "./profile";

/**
 * 알림 설정에서 규칙인 것 둘 — **끌 수 없는 것**과 **켜져 있으면 안 되는 것**.
 */
describe("알림 채널 기본값", () => {
  it("거래성 알림의 인앱은 끌 수 없다", () => {
    // 예약이 취소됐다는 사실을 알 길이 아예 없어지면 안 된다
    expect(isInAppLocked("RESERVATION")).toBe(true);
    expect(isInAppLocked("SCHEDULE")).toBe(true);
    expect(isInAppLocked("CHAT")).toBe(false);
    expect(isInAppLocked("MARKETING")).toBe(false);
  });

  it("마케팅은 세 채널 모두 옵트인이다", () => {
    expect(defaultsFor("MARKETING")).toEqual({ inApp: false, push: false, email: false });
    expect(defaultsFor("RESERVATION")).toEqual({ inApp: true, push: true, email: true });
  });

  it("근무 알림은 사업장 구성원에게만 보인다", () => {
    expect(visibleGroups(false)).not.toContain("SCHEDULE");
    expect(visibleGroups(true)).toContain("SCHEDULE");
  });

  it("모르는 그룹은 받지 않는다", () => {
    expect(preferenceInputSchema.safeParse({ eventGroup: "NOPE", inApp: true, push: true, email: true }).success).toBe(false);
  });
});

describe("프로필 입력", () => {
  it("연락처는 비울 수 있다 — 필수가 아니다", () => {
    expect(profileInputSchema.safeParse({ name: "김고객", phone: "" }).success).toBe(true);
    expect(profileInputSchema.safeParse({ name: "김고객" }).success).toBe(true);
  });

  it("이름은 비울 수 없고, 전화번호 모양은 본다", () => {
    expect(profileInputSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(profileInputSchema.safeParse({ name: "김고객", phone: "1234" }).success).toBe(false);
  });
});
