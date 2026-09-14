import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, type DbLike } from "@/db/client";
import { products, reservations, resources, users, type OpeningHour } from "@/db/schema";
import type { ConflictingReservation } from "@/features/schedule/holidays";
import { addDays, openingWindows, type OpeningLike } from "@/features/schedule/resolve";

/**
 * 영업시간·상품 시간을 **줄일 때** 밖으로 밀려나는 예약을 찾는다 (9/14 결정 — 그런 변경은 막는다).
 *
 * 왜 막는가: 영업시간은 매장의 기본값이라 한 번 줄이면 그 뒤 모든 슬롯이 바뀐다. 휴무 등록(하루짜리 예외)은
 * 경고 후 강행을 허용하지만(`keepReservations`), 여기서는 사장님이 그 예약을 먼저 정리하게 한다 —
 * 이미 잡힌 예약은 남는데 손님은 "그 시간에 영업하지 않는 가게" 의 예약을 들고 있게 되기 때문이다.
 *
 * **넓히는 방향은 막지 않는다.** 범위가 늘어나면 기존 예약은 전부 그대로 안에 있다.
 */
export type LocalReservation = {
  id: string;
  code: string;
  productId: string;
  startAt: Date;
  endAt: Date;
  resourceName: string;
  customerName: string | null;
  status: string;
  /** 사업장 타임존의 달력 날짜 */
  startDate: string;
  endDate: string;
  /** 그 날짜 00:00 기준 분 */
  startMin: number;
  endMin: number;
};

/**
 * 그 예약이 새 시간 안에 **온전히** 들어가는가. 시작만 보지 않는다 — 끝나는 시각이 밖이면 손님이 쫓겨난다.
 *
 * 자정을 넘긴 예약이 까다롭다. 23:00~01:00 예약의 달력 날짜는 시작일이지만, 00:30 에 시작하는 예약은
 * **전날 영업일**에 속한다(20:00~02:00 영업의 새벽 시각). 그래서 두 번 본다 —
 * 제 날짜의 구간에 들어가거나, **전날 구간을 자정 너머로 이어 본 것**에 들어가면 안에 있는 것이다.
 */
export function fitsInHours(r: Pick<LocalReservation, "startDate" | "startMin" | "endMin" | "endDate">, hours: OpeningLike[]): boolean {
  const sameDay = r.startDate === r.endDate;
  const start = r.startMin;
  const end = sameDay ? r.endMin : r.endMin + 1440;
  const within = (windows: ReturnType<typeof openingWindows>, s: number, e: number) => windows.some((w) => w.start <= s && e <= w.end);
  if (within(openingWindows(hours, r.startDate, true), start, end)) return true;
  // 전날 영업이 이어진 경우 — 전날 구간에서 보면 이 예약은 1440 을 넘긴 분 좌표다
  return within(openingWindows(hours, addDays(r.startDate, -1), true), start + 1440, end + 1440);
}

/** 새 시간 밖으로 밀려나는 예약만 — `hoursFor` 가 상품마다 무엇이 적용되는지 정한다(상품 시간 우선) */
export function outsideHours(rows: LocalReservation[], hoursFor: (productId: string) => OpeningLike[]): ConflictingReservation[] {
  return rows
    .filter((r) => !fitsInHours(r, hoursFor(r.productId)))
    .map((r) => ({ id: r.id, code: r.code, startAt: r.startAt, endAt: r.endAt, resourceName: r.resourceName, customerName: r.customerName, status: r.status }));
}

/** 앞으로의 살아 있는 예약을 사업장 타임존 좌표로 읽는다. 지난 예약은 어차피 바뀐 시간의 영향을 받지 않는다 */
export async function futureReservationsLocal(businessId: string, tz: string, now: Date, opts: { productId?: string } = {}, q: DbLike = db): Promise<LocalReservation[]> {
  const localDate = sql<string>`(${reservations.startAt} at time zone ${tz})::date::text`;
  const localEndDate = sql<string>`(${reservations.endAt} at time zone ${tz})::date::text`;
  const localMin = sql<number>`(extract(hour from (${reservations.startAt} at time zone ${tz})) * 60 + extract(minute from (${reservations.startAt} at time zone ${tz})))::int`;
  const localEndMin = sql<number>`(extract(hour from (${reservations.endAt} at time zone ${tz})) * 60 + extract(minute from (${reservations.endAt} at time zone ${tz})))::int`;
  return q
    .select({
      id: reservations.id,
      code: reservations.code,
      productId: reservations.productId,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      resourceName: resources.name,
      customerName: users.name,
      status: reservations.status,
      startDate: localDate,
      endDate: localEndDate,
      startMin: localMin,
      endMin: localEndMin,
    })
    .from(reservations)
    .innerJoin(resources, eq(resources.id, reservations.resourceId))
    .leftJoin(users, eq(users.id, reservations.customerId))
    .where(
      and(
        eq(reservations.businessId, businessId),
        inArray(reservations.status, ["REQUESTED", "CONFIRMED"]),
        gte(reservations.startAt, now),
        opts.productId ? eq(reservations.productId, opts.productId) : undefined,
      ),
    )
    .orderBy(asc(reservations.startAt)) as Promise<LocalReservation[]>;
}

/**
 * 사업장 영업시간을 바꿀 때 걸리는 예약.
 *
 * **상품 시간을 따로 정한 상품은 영향을 받지 않는다** — 그 상품에는 사업장 영업시간이 적용되지 않기 때문이다.
 * 그래서 `opening_hours = []` 인 상품(= "영업시간과 동일" 토글이 켜진 것)만 본다.
 */
export async function conflictsForBusinessHours(businessId: string, next: OpeningHour[], tz: string, now: Date, q: DbLike = db): Promise<ConflictingReservation[]> {
  const rows = await futureReservationsLocal(businessId, tz, now, {}, q);
  if (rows.length === 0) return [];
  const following = new Set(
    (await q.select({ id: products.id, openingHours: products.openingHours }).from(products).where(eq(products.businessId, businessId)))
      .filter((p) => p.openingHours.length === 0)
      .map((p) => p.id),
  );
  return outsideHours(
    rows.filter((r) => following.has(r.productId)),
    () => next,
  );
}

/** 상품 시간을 바꿀 때 걸리는 예약. 토글을 켜는(빈 배열) 경우엔 사업장 영업시간이 적용된다 */
export async function conflictsForProductHours(
  businessId: string,
  productId: string,
  next: OpeningHour[],
  businessHours: OpeningHour[],
  tz: string,
  now: Date,
  q: DbLike = db,
): Promise<ConflictingReservation[]> {
  const rows = await futureReservationsLocal(businessId, tz, now, { productId }, q);
  const effective = next.length > 0 ? next : businessHours;
  return outsideHours(rows, () => effective);
}
