import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, reservationLogs, reservations, resources } from "@/db/schema";
import type { ISODateTime, ReservationStatus } from "@/features/booking/slot-types";
import { customerMailFor } from "./transition-rules";
import { formatInstant } from "./time";

/**
 * 고객 본인의 예약 내역 (`/me/reservations`) — FR-BOOK-080 의 고객 쪽.
 *
 * **워크인은 목록에 없다.** 워크인은 사업장 내부 계정(`walkin+{businessId}@internal`)이 들고 있어
 * 애초에 여기 걸리지 않는다. 그래도 조건에 `createdVia` 를 두지 않는 이유는, 손님이 전화로 잡고
 * 나중에 계정을 연결하는 흐름이 생기면 그때는 보여야 하기 때문이다 — 계정으로 가르는 것이 옳다.
 *
 * 다가오는 것과 지난 것을 **나눠서** 준다. 한 목록에 섞으면 정렬 방향이 서로 반대다:
 * 다가오는 것은 가까운 순(다음이 맨 위), 지난 것은 최근 순(방금 다녀온 것이 맨 위)이다.
 */
export type MyReservation = {
  id: string;
  code: string;
  status: ReservationStatus;
  /** **사업장 타임존의 벽시계** ISO — 콘솔 목록과 같은 규약이다(`console.ts`). 보는 사람의 시계로 옮기면 매장 시각과 어긋난다 */
  startAt: ISODateTime;
  endAt: ISODateTime;
  partySize: number;
  businessName: string;
  slug: string;
  productName: string;
  staffName: string | null;
};

/** 지난 목록의 상한. "내역" 이지 장부가 아니다 — 더 필요해지면 커서를 붙인다 (`LATER.md` L-45) */
export const PAST_LIMIT = 50;

const COLUMNS = {
  id: reservations.id,
  code: reservations.code,
  status: reservations.status,
  startAt: reservations.startAt,
  endAt: reservations.endAt,
  partySize: reservations.partySize,
  timezone: businesses.timezone,
  businessName: businesses.name,
  slug: businesses.slug,
  productName: products.name,
  staffName: resources.name,
};

function base() {
  return db
    .select(COLUMNS)
    .from(reservations)
    .innerJoin(businesses, eq(businesses.id, reservations.businessId))
    .innerJoin(products, eq(products.id, reservations.productId))
    .leftJoin(resources, eq(resources.id, reservations.resourceId));
}

/** 살아 있는 예약 — 아직 결과가 정해지지 않은 것들 */
const LIVE: ReservationStatus[] = ["REQUESTED", "CONFIRMED"];

export async function loadMyReservations(customerId: string): Promise<{ upcoming: MyReservation[]; past: MyReservation[] }> {
  const [upcoming, past] = await Promise.all([
    // **지난 시각인데 아직 살아 있는 예약도 "다가오는" 쪽에 둔다.** 어제 다녀온 예약이 COMPLETED 로
    // 넘어가기 전까지 목록에서 사라지면 손님은 예약이 없어진 줄 안다. 상태 전이는 매장·배치의 속도에 달렸다
    base()
      .where(and(eq(reservations.customerId, customerId), inArray(reservations.status, LIVE)))
      .orderBy(asc(reservations.startAt)),
    base()
      .where(
        and(
          eq(reservations.customerId, customerId),
          // 끝난 것 = 결과가 정해진 것(완료·노쇼·취소·만료). 살아 있는 것은 시각과 무관하게 위 목록에 있다.
          // `sql` 로 `<> all(...)` 을 쓰면 드리즐이 배열을 파라미터 목록으로 펼쳐 42809 가 된다 — notInArray 를 쓴다
          notInArray(reservations.status, LIVE),
        ),
      )
      .orderBy(desc(reservations.startAt))
      .limit(PAST_LIMIT),
  ]);
  return { upcoming: upcoming.map(shape), past: past.map(shape) };
}

type Row = Awaited<ReturnType<ReturnType<typeof base>["where"]>>[number];

function shape(r: Row): MyReservation {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    startAt: formatInstant(r.startAt.getTime(), r.timezone),
    endAt: formatInstant(r.endAt.getTime(), r.timezone),
    partySize: r.partySize,
    businessName: r.businessName,
    slug: r.slug,
    productName: r.productName,
    staffName: r.staffName,
  };
}

/** 다가오는 예약 수 — 헤더 배지 같은 곳에서 쓸 수 있게 따로 둔다 (지금은 목록 길이로 충분해 쓰지 않는다) */
export async function upcomingCount(customerId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.customerId, customerId), inArray(reservations.status, LIVE), gte(reservations.startAt, now)));
  return row?.n ?? 0;
}

/**
 * 예약 상세 (FR-BOOK-090, #89). 목록과 **같은 함수로 합치지 않는다** —
 * 목록은 최대 50건을 가볍게 읽고, 상세는 한 건에 매장 연락처·요청사항·이력까지 붙인다.
 * 한 쿼리로 겸하면 목록이 쓰지도 않는 컬럼을 50번 실어 나른다.
 */
export type ReservationEvent = { at: ISODateTime; status: ReservationStatus; reason: string | null };

export type MyReservationDetail = MyReservation & {
  /** 변경 링크에 실어야 한다 — 서버는 **같은 상품 안에서만** 변경을 받는다(PRODUCT_MISMATCH) */
  productId: string;
  productName: string;
  customerNote: string | null;
  /** 매장에 가거나 전화할 때 필요한 것 — 상세가 존재하는 이유의 절반이다 */
  businessPhone: string | null;
  businessAddress: string | null;
  timezone: string;
  /** 취소 마감 판정에 쓰는 원본 — 화면은 `customerCancelState` 로 답을 얻는다 */
  cancelDeadlineHours: number;
  startInstant: string;
  endInstant: string;
  history: ReservationEvent[];
};

/**
 * **본인 것이 아니면 `null`** 이고 화면은 404 를 낸다 (FR-BOOK-090 보안).
 * 403 이 아닌 이유: 403 은 "그 id 의 예약이 있다" 를 알려 준다. 남의 예약번호를 넣어 보는 것만으로
 * 존재 여부가 새면 안 된다.
 */
export async function loadMyReservationDetail(customerId: string, id: string): Promise<MyReservationDetail | null> {
  const [r] = await db
    .select({
      ...COLUMNS,
      productId: reservations.productId,
      customerNote: reservations.customerNote,
      cancelDeadlineHours: reservations.cancelDeadlineHours,
      businessPhone: businesses.phone,
      businessAddress: businesses.address,
      addressDetail: businesses.addressDetail,
    })
    .from(reservations)
    .innerJoin(businesses, eq(businesses.id, reservations.businessId))
    .innerJoin(products, eq(products.id, reservations.productId))
    .leftJoin(resources, eq(resources.id, reservations.resourceId))
    .where(and(eq(reservations.id, id), eq(reservations.customerId, customerId)))
    .limit(1);
  if (!r) return null;

  return {
    ...shape(r),
    productId: r.productId,
    customerNote: r.customerNote,
    businessPhone: r.businessPhone,
    businessAddress: [r.businessAddress, r.addressDetail].filter(Boolean).join(" ") || null,
    timezone: r.timezone,
    cancelDeadlineHours: r.cancelDeadlineHours,
    startInstant: r.startAt.toISOString(),
    endInstant: r.endAt.toISOString(),
    history: await loadHistory(id, r.timezone),
  };
}

/**
 * 상태 이력. 정본은 `reservation_logs` 다 — 명세가 "상태 변경 이력(누가·언제·무엇을·왜)" 으로 둔 바로 그 테이블이고,
 * 생성도 `fromStatus = null` 한 줄로 남아 있어 시작점을 따로 지어낼 필요가 없다.
 * (감사 로그에도 같은 사건이 있지만 그건 운영자의 전역 로그다. `target_id` 가 text 라 조인도 캐스팅이 필요하다.)
 *
 * **누가 했는지는 내보내지 않는다.** 손님에게 필요한 것은 "언제 무엇이 됐나" 이고, 매장 안에서 누가 눌렀는지는
 * 매장 사정이다(콘솔 쪽 이력은 담당자 이름을 보여 준다 — `console.ts`).
 *
 * 사유는 **이미 손님에게 메일로 나간 전이의 것만** 보여 준다. 거절·매장 취소의 사유가 그것이고,
 * 완료↔노쇼 교정처럼 매장 내부에서 적은 사유는 손님이 볼 문장으로 쓰인 적이 없다.
 */
async function loadHistory(id: string, timezone: string): Promise<ReservationEvent[]> {
  const rows = await db
    .select({ at: reservationLogs.createdAt, to: reservationLogs.toStatus, reason: reservationLogs.reason })
    .from(reservationLogs)
    .where(eq(reservationLogs.reservationId, id))
    .orderBy(asc(reservationLogs.createdAt));
  // 시각은 다른 모든 곳과 같이 **사업장 타임존의 벽시계**다 — 보는 사람의 시계로 옮기면 매장 시각과 어긋난다
  return rows.map((r) => ({ at: formatInstant(r.at.getTime(), timezone), status: r.to, reason: customerMailFor(r.to) ? r.reason : null }));
}
