import { and, count, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, notifications } from "@/db/schema";
import { EVENT_LABEL, type EventType } from "./events";

/**
 * 인앱 알림함 (FR-NOTI-030, #98).
 *
 * **미읽음 배지는 헤더가 매 요청 읽는다.** 그래서 목록과 따로 세는 함수를 둔다 —
 * 배지 하나 그리자고 50건을 실어 나를 이유가 없다.
 */
export const INBOX_PAGE = 20;
/** 30일 지난 것은 자동 정리 대상 (명세). 알림함은 기록 보관소가 아니다 */
export const KEEP_DAYS = 30;

export type InboxItem = {
  id: string;
  event: EventType;
  label: string;
  title: string;
  body: string;
  linkUrl: string;
  businessName: string | null;
  at: Date;
  read: boolean;
};

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** 최신순. `offset` 으로 더 읽는다 — 알림함은 30일치라 커서를 붙일 만큼 길지 않다 */
export async function listInbox(userId: string, offset = 0): Promise<{ items: InboxItem[]; hasMore: boolean }> {
  const rows = await db
    .select({
      id: notifications.id,
      event: notifications.eventType,
      title: notifications.title,
      body: notifications.body,
      linkUrl: notifications.linkUrl,
      at: notifications.createdAt,
      readAt: notifications.readAt,
      businessName: businesses.name,
    })
    .from(notifications)
    .leftJoin(businesses, eq(businesses.id, notifications.businessId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(INBOX_PAGE + 1)
    .offset(Math.max(0, offset));

  return {
    items: rows.slice(0, INBOX_PAGE).map((r) => ({
      id: r.id,
      event: r.event,
      label: EVENT_LABEL[r.event],
      title: r.title,
      body: r.body,
      linkUrl: r.linkUrl,
      businessName: r.businessName,
      at: r.at,
      read: r.readAt !== null,
    })),
    hasMore: rows.length > INBOX_PAGE,
  };
}

/**
 * 읽음 처리. **이미 읽은 것은 건드리지 않는다**(`readAt is null` 조건) — 다시 눌렀다고
 * 읽은 시각이 뒤로 밀리면 "언제 봤나" 가 무의미해진다.
 */
export async function markRead(userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/**
 * 30일 지난 알림 정리 — 야간 틱이 부른다.
 * **읽었는지와 무관하게** 지운다. 안 읽은 채 30일이 지난 알림은 이제 와 읽어도 소용이 없고,
 * 남겨 두면 배지 숫자가 영원히 줄지 않는다.
 */
export async function purgeOldNotifications(now = new Date(), limit = 500): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const rows = await db
    .delete(notifications)
    .where(sql`${notifications.id} in (select id from ${notifications} where ${lt(notifications.createdAt, cutoff)} limit ${limit})`)
    .returning({ id: notifications.id });
  return rows.length;
}
