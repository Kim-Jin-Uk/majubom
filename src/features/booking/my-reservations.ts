import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, reservations, resources } from "@/db/schema";
import type { ISODateTime, ReservationStatus } from "@/features/booking/slot-types";
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
