import { describe, expect, it } from "vitest";
import { decideChannels, isQuietHour, type DecideInput } from "./channels";

/**
 * 채널 결정 (FR-NOTI-020). 여기서 틀리면 **알림이 조용히 사라진다** — 아무도 오류를 보지 못하고,
 * 손님은 예약이 확정된 줄 모른 채 안 온다. 그래서 경계마다 테스트를 건다.
 */
const base: DecideInput = { event: "RESERVATION_CONFIRMED", pref: null, hasPushToken: false, emailVerified: true };
const NOON = 12;

describe("푸시 폴백", () => {
  it("토큰이 없으면 그 자리를 이메일이 대신한다", () => {
    // iOS 미설치 사용자는 푸시가 아예 불가하다 — 폴백이 없으면 확정 알림이 아무 데로도 가지 않는다
    const d = decideChannels({ ...base, hasPushToken: false }, NOON);
    expect(d).toMatchObject({ push: false, email: true, inApp: true });
  });

  it("토큰이 있으면 푸시로 간다", () => {
    expect(decideChannels({ ...base, hasPushToken: true }, NOON)).toMatchObject({ push: true });
  });

  it("원래 이메일이 없던 이벤트도 푸시가 막히면 메일로 내려간다", () => {
    // 교대 요청은 명세상 웹푸시 전용이다. 토큰이 없다고 아무것도 안 보내면 72시간 시한을 놓친다
    const d = decideChannels({ ...base, event: "SHIFT_REQUESTED", hasPushToken: false }, NOON);
    expect(d.email).toBe(true);
  });
});

describe("거래성 인앱은 끌 수 없다", () => {
  it("설정이 전부 꺼져 있어도 인앱은 남는다", () => {
    // 예약이 취소된 사실을 알 길이 아예 없어지면 안 된다
    const d = decideChannels({ ...base, pref: { inApp: false, push: false, email: false } }, NOON);
    expect(d.inApp).toBe(true);
    expect(d.skipped).toBeNull();
  });

  it("채팅은 끌 수 있다 — 거래성이 아니다", () => {
    const d = decideChannels({ ...base, event: "CHAT_NEW_MESSAGE", pref: { inApp: false, push: false, email: false } }, NOON);
    expect(d).toMatchObject({ inApp: false, push: false, email: false, skipped: "OPTED_OUT" });
  });
});

describe("조용한 시간", () => {
  it("21시부터 다음 날 8시 전까지다", () => {
    expect([21, 23, 0, 7].every(isQuietHour)).toBe(true);
    expect([8, 12, 20].some(isQuietHour)).toBe(false);
  });

  it("마케팅만 막고 거래성은 그대로 간다", () => {
    // 예약 취소를 아침까지 미룰 수는 없다
    expect(decideChannels({ ...base, event: "RESERVATION_CANCELED_BY_BIZ" }, 23).skipped).toBeNull();
  });
});

describe("미검증 이메일", () => {
  it("거래성은 보낸다 — 검증 메일 자체가 거래성이다", () => {
    expect(decideChannels({ ...base, emailVerified: false }, NOON).email).toBe(true);
  });
});

describe("일일 한도", () => {
  it("바깥으로 나가는 것만 멈추고 인앱은 남긴다", () => {
    // 인앱은 우리 DB 한 줄이라 한도와 무관하다 — 여기까지 막으면 이력조차 남지 않는다
    const d = decideChannels({ ...base, overDailyLimit: true }, NOON);
    expect(d).toMatchObject({ inApp: true, push: false, email: false, skipped: "DAILY_LIMIT" });
  });
});

describe("같은 방을 보고 있으면", () => {
  it("아무것도 보내지 않는다", () => {
    expect(decideChannels({ ...base, event: "CHAT_NEW_MESSAGE", inActiveRoom: true }, NOON)).toMatchObject({ skipped: "ACTIVE_ROOM" });
  });
});
