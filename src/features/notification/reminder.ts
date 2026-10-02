import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, notifications, products, reservations, resources, users } from "@/db/schema";
import { whenText } from "@/features/booking/notify-text";
import { inBatches, MAIL_CONCURRENCY } from "@/lib/batches";
import { reservationReminderMail } from "@/lib/mail/templates";
import { notify } from "./notify";

/**
 * 방문 리마인더 (FR-NOTI-010 "시작 24시간 전", #99). 매시 정각 틱이 부른다.
 *
 * **다음 한 시간 안에 '24시간 전' 이 도래하는 예약**을 찾는다 — 즉 지금부터 24~25시간 뒤에 시작하는 건들.
 * 창을 한 시간으로 잡는 이유는 크론 주기와 같기 때문이다. 좁히면 사이로 빠지고, 넓히면 겹쳐서 두 번 간다.
 *
 * **멱등하다.** 이미 `RESERVATION_REMINDER` 를 적재한 예약은 건너뛴다(명세: "발송 이력에 없는 건만").
 * 배치가 두 번 돌아도, 서버가 중간에 죽었다 살아나도 손님은 한 번만 받는다.
 */
export async function sendReminders(now = new Date(), limit = 500): Promise<number> {
  const from = new Date(now.getTime() + 24 * 3_600_000);
  const to = new Date(from.getTime() + 3_600_000);

  const due = await db
    .select({
      id: reservations.id,
      code: reservations.code,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      partySize: reservations.partySize,
      customerId: reservations.customerId,
      businessId: reservations.businessId,
      email: users.email,
      businessName: businesses.name,
      slug: businesses.slug,
      timezone: businesses.timezone,
      productName: products.name,
      staffName: resources.name,
    })
    .from(reservations)
    .innerJoin(users, eq(users.id, reservations.customerId))
    .innerJoin(businesses, eq(businesses.id, reservations.businessId))
    .innerJoin(products, eq(products.id, reservations.productId))
    .leftJoin(resources, eq(resources.id, reservations.resourceId))
    .where(
      and(
        eq(reservations.status, "CONFIRMED"),
        gte(reservations.startAt, from),
        lt(reservations.startAt, to),
        // 워크인은 사업장 내부 계정이 들고 있어 보낼 곳이 없다 (FR-BOOK-070)
        sql`${reservations.createdVia} <> 'WALK_IN'`,
        // 이미 보낸 건은 뺀다 — 이 조건 하나가 멱등성의 전부다
        sql`not exists (
          select 1 from ${notifications} n
          where n.user_id = ${reservations.customerId}
            and n.event_type = 'RESERVATION_REMINDER'
            and n.link_url = '/me/reservations/' || ${reservations.id}::text
        )`,
      ),
    )
    .orderBy(reservations.startAt)
    .limit(limit);

  /**
   * **하나씩 기다리지 않는다.** 500건이 메일 왕복을 순차로 기다리면 매시 틱이 그만큼 길어지고,
   * 같은 틱에 든 교대 만료까지 밀린다 — `expireRequests` 가 먼저 세운 규약을 그대로 쓴다 (리뷰 지적).
   */
  let sent = 0;
  await inBatches(due, MAIL_CONCURRENCY, async (r) => {
    const when = whenText(r.startAt, r.endAt, r.timezone);
    const url = `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/me/reservations/${r.id}`;
    const d = await notify(
      {
        userId: r.customerId,
        event: "RESERVATION_REMINDER",
        businessId: r.businessId,
        title: `${r.businessName} · ${r.productName}`,
        body: `${when} · 예약번호 ${r.code}`,
        linkUrl: `/me/reservations/${r.id}`,
        mail: reservationReminderMail(r.email, {
          businessName: r.businessName,
          productName: r.productName,
          when,
          partySize: r.partySize,
          code: r.code,
          url,
        }),
      },
      now,
    );
    if (d) sent++;
  });
  return sent;
}
