import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAtOnly, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { eventGroupEnum, notificationEventTypeEnum, pushPlatformEnum } from "./enums";
import { users } from "./users";

/**
 * PushSubscription — FCM 등록 토큰 (02 §2.2 v1.5, FR-PWA-030).
 * VAPID 구독 3종(endpoint/p256dh/auth)은 보관하지 않는다. Firebase SDK 가 처리하고 우리는 토큰 문자열 하나만 저장한다.
 * 사용자당 최대 5대 (앱 검증). 발송 응답 UNREGISTERED / INVALID_ARGUMENT 면 즉시 삭제.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    fcmToken: text("fcm_token").notNull().unique(),
    /** "iPhone Safari" 등 사용자 표시용 */
    deviceLabel: varchar("device_label", { length: 100 }),
    platform: pushPlatformEnum("platform").notNull(),
    /** PWA 설치 상태에서 등록됐는지 (iOS 판별용) */
    isStandalone: boolean("is_standalone").notNull().default(false),
    /** 만료 정리 배치 기준 */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...createdAtOnly,
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

export type ChannelResult = "SENT" | "FAILED" | "SKIPPED";
export type NotificationChannels = { inApp: boolean; push?: ChannelResult; email?: ChannelResult };

/** Notification — 인앱 알림함 + 발송 이력 (FR-NOTI-030). title/body 는 90일 후 삭제 배치 대상. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** 사업장 컨텍스트 (선택) */
    businessId: uuid("business_id").references(() => businesses.id),
    eventType: notificationEventTypeEnum("event_type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url").notNull(),
    channels: jsonb("channels").$type<NotificationChannels>().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    ...createdAtOnly,
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

/**
 * NotificationPreference — 사용자 × 이벤트 그룹 (사용자당 4행).
 * 거래성(RESERVATION·SCHEDULE) 의 in_app 은 항상 true, MARKETING 은 세 채널 기본 false — 앱 규칙.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventGroup: eventGroupEnum("event_group").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    push: boolean("push").notNull().default(true),
    email: boolean("email").notNull().default(true),
  },
  (t) => [primaryKey({ name: "notification_preferences_pk", columns: [t.userId, t.eventGroup] })],
);
