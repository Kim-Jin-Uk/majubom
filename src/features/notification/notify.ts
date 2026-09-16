import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, notificationPreferences, notifications, pushSubscriptions, users, type NotificationChannels } from "@/db/schema";
import { localToInstant } from "@/features/booking/time";
import { todayIn } from "@/lib/dates";
import { decideChannels, type Decision } from "./channels";
import { EVENT_GROUP, type EventType } from "./events";

/**
 * 알림 적재·발송 (FR-NOTI-010 · FR-NOTI-020, #96 · #97).
 *
 * ## 이 함수는 절대 던지지 않는다
 * 부르는 쪽은 이미 커밋된 일(예약 확정·교대 승인)의 뒤에 있다. 알림 실패로 예외가 나가면 라우트가 500 을
 * 돌려주고 화면에는 "실패했다" 가 뜨는데 일은 이미 벌어져 있다 — 가장 나쁜 결과다.
 * (`booking/notify.ts` 가 세운 규약을 그대로 잇는다.)
 *
 * ## 인앱은 먼저, 바깥은 나중
 * 인앱 한 줄은 우리 DB 라 거의 실패하지 않는다. 그걸 먼저 남기면 메일이 실패해도 **알림함에는 남는다** —
 * "왜 안 왔지" 를 손님이 되짚을 자리가 생긴다.
 */
export type NotifyInput = {
  userId: string;
  event: EventType;
  title: string;
  body: string;
  linkUrl: string;
  /** 사업장 맥락 — 일일 한도를 세는 단위이기도 하다 */
  businessId?: string | null;
  /** 채팅: 상대가 그 방을 보고 있는가 */
  inActiveRoom?: boolean;
  /** 메일을 보낼 때 쓸 내용. 없으면 title/body 를 그대로 쓴다 */
  mail?: { subject: string; text: string; html?: string };
};

/** 사업장 하루 발송 상한 (plan 기준). 숫자는 `LATER.md` L-46 — Resend 계정 한도가 진짜 천장이다 */
export const DAILY_LIMIT = { FREE: 200, BASIC: 500 } as const;
const NOTI_TZ = "Asia/Seoul";

/** 그날(KST) 이 사업장 앞으로 쌓인 알림 수. 경계는 다른 곳과 같이 KST 자정이다 */
export async function sentTodayFor(businessId: string, now = new Date()): Promise<number> {
  const dayStart = new Date(localToInstant(todayIn(NOTI_TZ, now), 0, NOTI_TZ));
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.businessId, businessId), gte(notifications.createdAt, dayStart)));
  return row?.n ?? 0;
}

/** 그 사업장의 하루 상한 — 플랜을 읽는다. 사업장 맥락이 없는 알림(운영자 앞)은 한도를 세지 않는다 */
async function overLimit(businessId: string | null | undefined, now: Date): Promise<boolean> {
  if (!businessId) return false;
  const [b] = await db.select({ plan: businesses.plan }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return (await sentTodayFor(businessId, now)) >= DAILY_LIMIT[b?.plan ?? "FREE"];
}

export async function notify(input: NotifyInput, now = new Date()): Promise<Decision | null> {
  try {
    const [who] = await db
      .select({ email: users.email, name: users.name, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!who) return null;

    const [pref] = await db
      .select({ inApp: notificationPreferences.inApp, push: notificationPreferences.push, email: notificationPreferences.email })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, input.userId), eq(notificationPreferences.eventGroup, EVENT_GROUP[input.event])))
      .limit(1);

    const [token] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, input.userId)).limit(1);

    const overDailyLimit = await overLimit(input.businessId, now);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: NOTI_TZ, hour: "2-digit", hourCycle: "h23" }).format(now));

    const decision = decideChannels(
      {
        event: input.event,
        pref: pref ?? null,
        hasPushToken: Boolean(token),
        emailVerified: who.verifiedAt !== null,
        overDailyLimit,
        inActiveRoom: input.inActiveRoom,
      },
      hour,
    );

    // 아무 채널도 안 남았으면 이력도 남기지 않는다 — 알림함에 보이지 않을 줄을 쌓을 이유가 없다.
    // 다만 왜 걸렀는지는 돌려준다(부르는 쪽이 로그에 남긴다)
    if (!decision.inApp && !decision.push && !decision.email) return decision;

    const channels: NotificationChannels = {
      inApp: decision.inApp,
      // 푸시는 보낼 수단이 아직 없다(에픽 #16). 켜졌다고 `SENT` 로 적으면 이력이 거짓말을 한다
      push: decision.push ? "SKIPPED" : undefined,
      email: decision.email ? "SENT" : undefined,
    };

    // **인앱 줄을 먼저 남긴다** — 메일이 실패해도 알림함에는 남아야 한다
    const [row] = await db.insert(notifications).values({
      userId: input.userId,
      businessId: input.businessId ?? null,
      eventType: input.event,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      channels,
    }).returning({ id: notifications.id });

    if (decision.email) await sendWithRetry(row.id, who.email, input, channels);
    return decision;
  } catch (e) {
    // 던지지 않는다 (위 주석). 사라진 알림을 나중에 찾을 수 있게 이벤트와 대상만 남긴다 — 주소는 남기지 않는다
    console.error(`[notify] ${input.event} user=${input.userId} 실패:`, (e as Error).message);
    return null;
  }
}

/**
 * 메일 3회 재시도, 지수 백오프 (FR-NOTI-020). 마지막까지 실패하면 이력의 `email` 을 `FAILED` 로 돌린다 —
 * 보냈다고 적힌 이력이 남는 것이 안 보낸 것보다 나쁘다.
 */
const RETRY_DELAYS_MS = [400, 1_600];

async function sendWithRetry(id: string, to: string, input: NotifyInput, channels: NotificationChannels): Promise<void> {
  const { sendMail } = await import("@/lib/mail");
  const mail = input.mail ?? { subject: input.title, text: input.body };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendMail({ to, ...mail });
      return;
    } catch (e) {
      if (attempt === RETRY_DELAYS_MS.length) {
        console.error(`[notify] ${input.event} 메일 최종 실패:`, (e as Error).message);
        // **방금 넣은 그 줄만** 고친다. 이벤트·링크로 찾으면 리마인더처럼 링크가 같은 옛 줄까지 함께 뒤집힌다
        await db.update(notifications).set({ channels: { ...channels, email: "FAILED" } }).where(eq(notifications.id, id));
        return;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}
