import { defaultsFor, isInAppLocked, type Channels, type EventGroup } from "@/features/me/notification-rules";
import { EVENT_CHANNELS, EVENT_GROUP, type EventType } from "./events";

/**
 * 채널 결정 (FR-NOTI-020, #97). **순수 모듈이다** — DB 도 시계도 모른다(`now` 를 받는다).
 *
 * 명세의 순서 그대로: **수신 설정 → 유효한 FCM 토큰 → 없으면 이메일 폴백.**
 * 마지막 단계가 핵심이다. iOS 미설치 사용자는 푸시가 아예 불가하므로(FR-PWA-030),
 * "푸시로 보내기로 한 알림" 이 조용히 사라지지 않고 메일로 내려간다.
 */
export type Decision = {
  inApp: boolean;
  push: boolean;
  email: boolean;
  /** 아무 채널도 남지 않은 이유. 로그·이력에 남겨 "왜 안 왔지" 를 되짚을 수 있게 */
  skipped: "OPTED_OUT" | "QUIET_HOURS" | "DAILY_LIMIT" | "ACTIVE_ROOM" | null;
};

export type DecideInput = {
  event: EventType;
  /** 없으면 기본값 (행을 미리 만들지 않는다 — `notification-rules.ts`) */
  pref: Channels | null;
  /** 유효한 FCM 토큰이 하나라도 있는가 */
  hasPushToken: boolean;
  /** 이메일을 보낼 수 있는가 — 미검증 주소는 마케팅만 보류한다 (#100) */
  emailVerified: boolean;
  /** 사업장 일일 발송 한도를 이미 넘겼는가 */
  overDailyLimit?: boolean;
  /** 채팅: 상대가 그 방을 지금 보고 있는가 (FR-NOTI-010 "같은 방 활성 중이면 생략") */
  inActiveRoom?: boolean;
};

/** 마케팅 금지 시간대 — 21시부터 다음 날 8시까지 (명세 §2.2 주석) */
export const QUIET_FROM = 21;
export const QUIET_TO = 8;

export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

export function decideChannels(input: DecideInput, hourOfDay: number): Decision {
  const none: Decision = { inApp: false, push: false, email: false, skipped: null };
  const group: EventGroup = EVENT_GROUP[input.event];
  const pref = input.pref ?? defaultsFor(group);
  const wanted = EVENT_CHANNELS[input.event];

  // 채팅은 **보고 있는 사람에게 알리지 않는다.** 방을 열어 둔 채로 알림까지 받으면 소음이다
  if (input.inActiveRoom) return { ...none, skipped: "ACTIVE_ROOM" };

  // 마케팅은 밤에 보내지 않는다. 거래성은 시간과 무관하다 — 예약이 취소된 사실은 아침까지 미룰 것이 아니다
  if (group === "MARKETING" && isQuietHour(hourOfDay)) return { ...none, skipped: "QUIET_HOURS" };

  // 거래성 인앱은 끌 수 없다 — 설정이 꺼져 있어도 켠 것으로 본다 (FR-NOTI-030 고정 규칙)
  const inApp = wanted.inApp && (isInAppLocked(group) || pref.inApp);

  /**
   * **푸시는 토큰이 있을 때만.** 없으면 그 자리를 이메일이 대신한다 — 원래 이메일을 안 보내던
   * 이벤트여도 그렇다. 이 폴백이 없으면 iOS 미설치 사용자에게는 "예약 확정" 이 아무 데로도 가지 않는다.
   */
  const push = wanted.push && pref.push && input.hasPushToken;
  const pushFellBack = wanted.push && pref.push && !input.hasPushToken;

  // 미검증 주소로는 **마케팅만** 참는다. 거래성은 보내야 한다 — 검증 메일 자체가 거래성이다
  const emailAllowed = input.emailVerified || group !== "MARKETING";
  const email = (wanted.email || pushFellBack) && pref.email && emailAllowed;

  // 한도를 넘겼으면 **바깥으로 나가는 것만** 멈춘다. 인앱은 우리 DB 한 줄이라 한도와 무관하다
  if (input.overDailyLimit && (push || email)) {
    return { inApp, push: false, email: false, skipped: "DAILY_LIMIT" };
  }

  if (!inApp && !push && !email) return { ...none, skipped: "OPTED_OUT" };
  return { inApp, push, email, skipped: null };
}
