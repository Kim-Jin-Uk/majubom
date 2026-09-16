import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, reservations, resources, users } from "@/db/schema";
import { sendMail } from "@/lib/mail";
import { reservationCanceledByBizMail, reservationConfirmedMail, reservationExpiredMail, reservationReassignedMail, reservationRejectedMail, reservationRequestedMail, type ReservationMailInfo } from "@/lib/mail/templates";
import { notify } from "@/features/notification/notify";
import { reservationHandlers } from "@/features/notification/recipients";
import type { EventType } from "@/features/notification/events";
import { whenText } from "./notify-text";
import type { ReservationMailEvent } from "./transition-rules";

export type { ReservationMailEvent };

/**
 * 예약 알림 (FR-NOTI-010, #96). **손님과 매장 양쪽에** 간다.
 *
 * 채널 결정·발송 이력·재시도·수신 설정은 전부 `features/notification` 이 한다 — 여기서는
 * "이 전이 뒤에 누구에게 무엇을 알리는가" 만 정한다. 원래 여기 있던 `sendMail` 직접 호출을
 * 그 계층으로 옮긴 것이고(#57 → #14), 호출부는 바뀌지 않았다.
 *
 * ## 이 함수는 절대 던지지 않는다
 * 예약은 이미 커밋됐다. 알림 실패로 예외가 나가면 라우트가 500 을 돌려주고, 손님 화면에는
 * "예약에 실패했다" 가 뜨는데 예약은 잡혀 있다 — 가장 나쁜 결과다.
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
        customerId: reservations.customerId,
        customerName: users.name,
        businessId: reservations.businessId,
        resourceId: reservations.resourceId,
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

    /**
     * 담당자 변경(`REASSIGNED`)은 **메일만** 나간다. 명세의 알림 이벤트 표에 그 코드가 없어서다 —
     * 없는 코드를 지어내면 수신 설정의 그룹도, 알림함의 이름도 우리 마음대로가 된다 (`LATER.md` L-47).
     */
    if (event === "REASSIGNED") {
      await sendMail(mail);
      return;
    }

    const type = CUSTOMER_EVENT[event];
    await notify({
      userId: r.customerId,
      event: type,
      businessId: r.businessId,
      title: `${r.businessName} · ${r.productName}`,
      body: bodyFor(info.when, r.code, reason),
      linkUrl: `/me/reservations/${id}`,
      mail: { subject: mail.subject, text: mail.text, html: mail.html },
    });

    // **매장에도 알린다.** 손님이 잡거나 취소한 것을 매장이 늦게 아는 것이 이 서비스의 원래 문제다
    for (const to of await handlersFor(event, r.businessId, r.resourceId)) {
      await notify({
        userId: to.userId,
        event: type,
        businessId: r.businessId,
        title: `${r.productName} · ${r.customerName ?? "고객"}`,
        body: `${info.when} · 예약번호 ${r.code}`,
        linkUrl: "/console/reservations",
      });
    }
  } catch (e) {
    // 주소는 남기지 않는다 (FR-PRIV-010). 예약 id 만 있으면 어떤 건인지 찾을 수 있다
    console.error(`[notify] 예약 메일 실패 reservation=${id} event=${event}: ${(e as Error).message}`);
  }
}

/** 손님에게 가는 전이 → 알림 이벤트 코드 */
const CUSTOMER_EVENT = {
  REQUESTED: "RESERVATION_REQUESTED",
  CONFIRMED: "RESERVATION_CONFIRMED",
  REJECTED: "RESERVATION_REJECTED",
  CANCELED_BY_BIZ: "RESERVATION_CANCELED_BY_BIZ",
  EXPIRED: "RESERVATION_EXPIRED",
} as const satisfies Partial<Record<ReservationMailEvent, EventType>>;

/**
 * 매장 쪽 수신자. **전이마다 다르다** — 매장이 한 일(확정·거절·취소)을 매장에 다시 알리면 소음이다.
 * 알려야 하는 것은 **매장이 아직 모르는 일**뿐이다: 새 요청, 그리고 배치가 흘려보낸 만료.
 */
async function handlersFor(event: ReservationMailEvent, businessId: string, resourceId: string | null) {
  return event === "REQUESTED" || event === "EXPIRED" ? reservationHandlers(businessId, resourceId) : [];
}

/**
 * 알림함 한 줄의 본문. 제목이 "어디의 무엇" 이므로 여기는 **언제·무엇으로**를 말한다.
 * **예약번호를 넣는다** — 손님이 매장에 전화할 때 말할 값이 그것이고, 알림함은 그 값을 다시 찾는 자리이기도 하다.
 */
function bodyFor(when: string, code: string, reason: string | null): string {
  return `${when} · 예약번호 ${code}${reason ? ` — ${reason}` : ""}`;
}

function appUrl(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * 메일이 거는 링크 — **예약 상세**다.
 *
 * 한동안 매장 공개 홈을 걸어 뒀다. 그 화면(#89)이 없어서 누르면 404 였기 때문이다.
 * 이제 있으므로 원래 자리로 돌린다: 거기서 취소·시간 변경·캘린더 담기를 바로 할 수 있다.
 * (그 주석이 예고한 대로 이 함수 하나만 바뀌었다 — 템플릿 다섯은 그대로다.)
 */
function reservationUrl(slug: string, reservationId: string): string {
  void slug;
  return `${appUrl()}/me/reservations/${reservationId}`;
}
