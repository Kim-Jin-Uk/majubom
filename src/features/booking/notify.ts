import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, reservations, resources, users } from "@/db/schema";
import { sendMail } from "@/lib/mail";
import { reservationCanceledByBizMail, reservationConfirmedMail, reservationExpiredMail, reservationReassignedMail, reservationRejectedMail, reservationRequestedMail, type ReservationMailInfo } from "@/lib/mail/templates";
import { whenText } from "./notify-text";
import type { ReservationMailEvent } from "./transition-rules";

export type { ReservationMailEvent };

/**
 * 예약 메일 발송 (FR-NOTI-010 · #57 최소본).
 *
 * **손님에게 가는 것만** 여기서 보낸다. 매장 쪽 알림(담당 매니저 웹푸시·인앱)과 발송 이력·재시도·수신 설정은
 * 알림 에픽(#14)의 몫이다. 그때 이 함수는 `Notification` 적재로 갈아끼운다 — 그래서 호출부에는
 * "이 전이 뒤에 손님에게 알린다" 는 사실만 남기고 채널 결정은 전부 여기 안에 둔다.
 *
 * ## 이 함수는 절대 던지지 않는다
 * 예약은 이미 커밋됐다. 메일 실패로 예외가 나가면 라우트가 500 을 돌려주고, 손님 화면에는
 * "예약에 실패했다" 가 뜨는데 예약은 잡혀 있다 — 가장 나쁜 결과다. Resend 장애·주소 오류는
 * 로그로만 남기고 지나간다.
 */
export async function notifyReservation(id: string, event: ReservationMailEvent, opts: { reason?: string | null } = {}): Promise<void> {
  try {
    const [r] = await db
      .select({
        code: reservations.code,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        partySize: reservations.partySize,
        createdVia: reservations.createdVia,
        businessName: businesses.name,
        slug: businesses.slug,
        timezone: businesses.timezone,
        productName: products.name,
        staffName: resources.name,
        email: users.email,
      })
      .from(reservations)
      .innerJoin(businesses, eq(businesses.id, reservations.businessId))
      .innerJoin(products, eq(products.id, reservations.productId))
      .innerJoin(resources, eq(resources.id, reservations.resourceId))
      .innerJoin(users, eq(users.id, reservations.customerId))
      .where(eq(reservations.id, id))
      .limit(1);
    if (!r) return;
    // 워크인은 매장이 대신 넣은 건이다 — 고객 계정은 사업장별 내부 계정이라 보낼 곳이 없다 (FR-BOOK-070)
    if (r.createdVia === "WALK_IN") return;

    const info: ReservationMailInfo = {
      businessName: r.businessName,
      productName: r.productName,
      when: whenText(r.startAt, r.endAt, r.timezone),
      partySize: r.partySize,
      code: r.code,
      url: reservationUrl(r.slug, id),
    };
    const reason = opts.reason ?? null;
    const mail =
      event === "REQUESTED" ? reservationRequestedMail(r.email, info)
      : event === "CONFIRMED" ? reservationConfirmedMail(r.email, info)
      : event === "REJECTED" ? reservationRejectedMail(r.email, info, reason)
      : event === "CANCELED_BY_BIZ" ? reservationCanceledByBizMail(r.email, info, reason)
      : event === "REASSIGNED" ? reservationReassignedMail(r.email, info, r.staffName)
      : reservationExpiredMail(r.email, info);
    await sendMail(mail);
  } catch (e) {
    // 주소는 남기지 않는다 (FR-PRIV-010). 예약 id 만 있으면 어떤 건인지 찾을 수 있다
    console.error(`[notify] 예약 메일 실패 reservation=${id} event=${event}: ${(e as Error).message}`);
  }
}

function appUrl(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * 메일이 거는 링크. **지금은 매장의 공개 홈이다.**
 *
 * 원래 `/me/reservations/{id}` 를 걸었는데, 그 화면은 마이페이지 에픽(#87~#89)의 것이라 아직 없다 —
 * 손님이 확정 메일의 링크를 누르면 404 를 본다(리뷰 지적). 없는 화면으로 보내느니 매장 페이지가 낫다:
 * 전화번호·길찾기·영업시간이 거기 있어서 손님이 실제로 할 수 있는 일이 있다.
 *
 * 예약번호는 본문에 이미 있으므로 링크가 없어도 매장에서 조회된다.
 * **#89 가 붙으면 이 함수 하나만 바꾼다** — 다섯 통의 템플릿은 그대로다.
 */
function reservationUrl(slug: string, reservationId: string): string {
  void reservationId;
  return `${appUrl()}/@${slug}`;
}
