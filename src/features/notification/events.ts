import type { notificationEventTypeEnum } from "@/db/schema/enums";
import type { EventGroup } from "@/features/me/notification-rules";

/**
 * 알림 이벤트 표 (FR-NOTI-010, #96). **순수 모듈이다** — DB 도 메일도 모른다.
 *
 * 명세의 표를 **코드 한 곳에** 옮겨 둔다. 이벤트를 하나 늘릴 때 고칠 자리가 여기뿐이어야
 * "알림은 갔는데 알림함에는 없다" 거나 "그룹이 없어 수신 설정이 안 먹는다" 가 생기지 않는다.
 */
export type EventType = (typeof notificationEventTypeEnum.enumValues)[number];

/**
 * 이벤트가 속한 **그룹**. 수신 설정(`NotificationPreference`)은 그룹 단위라, 표에서 빠진 이벤트는
 * 사용자가 끄고 켤 수 없는 알림이 된다 — 그래서 `Record` 로 두어 **하나라도 빠지면 컴파일이 깨지게** 한다.
 */
export const EVENT_GROUP: Record<EventType, EventGroup> = {
  BUSINESS_APPLIED: "RESERVATION",
  BUSINESS_APPROVED: "RESERVATION",
  BUSINESS_REJECTED: "RESERVATION",
  MEMBER_INVITED: "SCHEDULE",
  RESERVATION_REQUESTED: "RESERVATION",
  RESERVATION_CONFIRMED: "RESERVATION",
  RESERVATION_REJECTED: "RESERVATION",
  RESERVATION_CANCELED_BY_USER: "RESERVATION",
  RESERVATION_CANCELED_BY_BIZ: "RESERVATION",
  RESERVATION_REMINDER: "RESERVATION",
  RESERVATION_EXPIRED: "RESERVATION",
  DAILY_RESERVATION_SUMMARY: "SCHEDULE",
  REQUEST_PENDING: "SCHEDULE",
  SHIFT_REQUESTED: "SCHEDULE",
  SHIFT_RESPONDED: "SCHEDULE",
  SHIFT_APPROVED: "SCHEDULE",
  USAGE_LIMIT_80: "SCHEDULE",
  CHAT_NEW_MESSAGE: "CHAT",
  CHAT_NEW_ROOM: "CHAT",
  CHAT_UNANSWERED: "CHAT",
  REPORT_RECEIVED: "SCHEDULE",
  REPORT_RESOLVED: "RESERVATION",
};

/**
 * 명세가 그 이벤트에 **원래 적어 둔 채널**. 실제로 무엇이 나가는지는 `channels.ts` 가 정한다
 * (수신 설정·푸시 토큰 유무·시간대를 본 뒤에).
 *
 * 여기 `push` 가 true 인데 지금 푸시를 보낼 수단이 없다 — 그건 **거짓이 아니라 미구현**이고,
 * 채널 결정이 "푸시 토큰이 없으면 이메일" 로 내려보낸다(FR-NOTI-020). 표를 명세대로 남겨 둬야
 * 에픽 #16 이 들어오는 날 고칠 곳이 `channels.ts` 하나로 남는다.
 */
export type Wanted = { inApp: boolean; push: boolean; email: boolean };

export const EVENT_CHANNELS: Record<EventType, Wanted> = {
  BUSINESS_APPLIED: { inApp: true, push: false, email: true },
  BUSINESS_APPROVED: { inApp: true, push: false, email: true },
  BUSINESS_REJECTED: { inApp: true, push: false, email: true },
  MEMBER_INVITED: { inApp: false, push: false, email: true },
  RESERVATION_REQUESTED: { inApp: true, push: true, email: true },
  RESERVATION_CONFIRMED: { inApp: true, push: true, email: true },
  RESERVATION_REJECTED: { inApp: true, push: false, email: true },
  RESERVATION_CANCELED_BY_USER: { inApp: true, push: true, email: false },
  RESERVATION_CANCELED_BY_BIZ: { inApp: true, push: true, email: true },
  RESERVATION_REMINDER: { inApp: true, push: true, email: true },
  RESERVATION_EXPIRED: { inApp: true, push: false, email: true },
  DAILY_RESERVATION_SUMMARY: { inApp: true, push: true, email: false },
  REQUEST_PENDING: { inApp: true, push: true, email: false },
  SHIFT_REQUESTED: { inApp: true, push: true, email: false },
  SHIFT_RESPONDED: { inApp: true, push: true, email: false },
  SHIFT_APPROVED: { inApp: true, push: true, email: false },
  USAGE_LIMIT_80: { inApp: true, push: false, email: true },
  CHAT_NEW_MESSAGE: { inApp: true, push: true, email: false },
  CHAT_NEW_ROOM: { inApp: true, push: true, email: false },
  CHAT_UNANSWERED: { inApp: true, push: true, email: false },
  REPORT_RECEIVED: { inApp: true, push: false, email: true },
  REPORT_RESOLVED: { inApp: true, push: false, email: false },
};

/**
 * 알림함에 보이는 이름. 제목은 **무슨 일이 있었는지**만 말하고, 누구의 무엇인지는 본문이 채운다 —
 * 목록에서 제목만 훑을 때 같은 말이 스무 줄 반복되지 않게.
 */
export const EVENT_LABEL: Record<EventType, string> = {
  BUSINESS_APPLIED: "새 가입 신청",
  BUSINESS_APPROVED: "가입이 승인됐어요",
  BUSINESS_REJECTED: "가입이 반려됐어요",
  MEMBER_INVITED: "매니저 초대",
  RESERVATION_REQUESTED: "새 예약 요청",
  RESERVATION_CONFIRMED: "예약이 확정됐어요",
  RESERVATION_REJECTED: "예약이 거절됐어요",
  RESERVATION_CANCELED_BY_USER: "손님이 예약을 취소했어요",
  RESERVATION_CANCELED_BY_BIZ: "예약이 취소됐어요",
  RESERVATION_REMINDER: "내일 방문 예정이에요",
  RESERVATION_EXPIRED: "승인 대기가 만료됐어요",
  DAILY_RESERVATION_SUMMARY: "오늘의 예약",
  REQUEST_PENDING: "아직 처리하지 않은 예약 요청",
  SHIFT_REQUESTED: "근무 교대 요청",
  SHIFT_RESPONDED: "교대 요청에 답이 왔어요",
  SHIFT_APPROVED: "교대가 승인됐어요",
  USAGE_LIMIT_80: "사용량이 한도의 80%예요",
  CHAT_NEW_MESSAGE: "새 메시지",
  CHAT_NEW_ROOM: "새 상담이 시작됐어요",
  CHAT_UNANSWERED: "답하지 않은 상담이 있어요",
  REPORT_RECEIVED: "신고가 접수됐어요",
  REPORT_RESOLVED: "신고 처리 결과",
};

/**
 * **거래성 이벤트** — 인앱을 끌 수 없는 것들 (FR-NOTI-030 고정 규칙).
 * 그룹(`RESERVATION`·`SCHEDULE`)으로 이미 잠기지만, 명세가 이름을 집어 둔 것들이라 표로도 남긴다.
 */
export const isTransactional = (t: EventType): boolean => EVENT_GROUP[t] === "RESERVATION" || EVENT_GROUP[t] === "SCHEDULE";
