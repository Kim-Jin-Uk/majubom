import { and, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, productResources, products, reservations, resources, workExceptions, workSchedules } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { mergePolicy } from "@/features/business/policy";
import { addDays } from "@/features/schedule/resolve";
import { holidaysForRange } from "@/features/schedule/holidays";
import type { Dow, ExistingReservation, FixedStartTimesEntry, Holiday, SlotContext, SlotIntervalMin, SlotResource, WorkException, WorkSchedule } from "./slot-types";
import { localToInstant } from "./time";

/**
 * DB → `SlotContext`. 슬롯 계산기(`slots.ts`)는 순수 함수라 DB 를 모른다 — 여기가 유일한 접점이다.
 *
 * 한 번 읽어 기간 전체를 계산한다(명세 성능 절: "해당 기간 예약은 한 번의 쿼리로 일괄 로드, N+1 금지",
 * "반복 휴무 전개는 DB 가 아니라 메모리에서"). 그래서 `SlotContext` 에는 날짜가 없고 `SlotQuery.date` 만 바뀐다.
 *
 * 예약 로드 범위는 명세 그대로 `[from 00:00 − (최대 이용시간 + 버퍼), (to + 2) 00:00)` — 전날 23시에 시작한 4시간 예약을 놓치지 않는다.
 * 근무 예외는 **APPROVED 만** 넣는다. 승인 대기 중인 휴가 신청은 근무표에 아직 반영되지 않았으므로 예약도 계속 받아야 한다.
 */

const asDow = (n: number) => n as Dow;

/**
 * 예약이 점유 구간(버퍼 포함)으로 기간에 걸치려면 시작 시각이 아무리 일러도 이만큼 안이다 —
 * 이용 시간 ≤ 480분(products CHECK) + 앞뒤 버퍼 각 ≤ 60분(productInputSchema). 인덱스(resource_id, start_at)를 태우려고 하한을 준다.
 */
const MAX_OCCUPY_TAIL_MIN = 480 + 60 + 60;

export type SlotContextOptions = {
  now?: Date;
  /** 공개 예약 경로 — 사업장 APPROVED + 상품 ACTIVE 가 아니면 404. 콘솔 대리 예약은 false */
  requirePublic?: boolean;
};

/** 사업장 타임존만 — 시작 시각이 어느 영업일에 속하는지 알아야 기간을 정할 수 있다 (예약 생성) */
export async function loadProductTimezone(productId: string, opts: { requirePublic?: boolean } = {}): Promise<string> {
  const [row] = await db.select({ tz: businesses.timezone, status: products.status, businessStatus: businesses.status }).from(products).innerJoin(businesses, eq(businesses.id, products.businessId)).where(eq(products.id, productId)).limit(1);
  if (!row) throw new HttpError(404, "NOT_FOUND");
  if (opts.requirePublic && (row.status !== "ACTIVE" || row.businessStatus !== "APPROVED")) throw new HttpError(404, "NOT_FOUND");
  return row.tz;
}

/** 슬롯 계산 입력 + 계산에는 안 쓰지만 저장할 때 필요한 것(businessId) */
export type BookingContext = { ctx: SlotContext; businessId: string };

export async function loadSlotContext(productId: string, from: string, to: string, opts: SlotContextOptions = {}): Promise<SlotContext> {
  return (await loadBookingContext(productId, from, to, opts)).ctx;
}

export async function loadBookingContext(productId: string, from: string, to: string, opts: SlotContextOptions = {}): Promise<BookingContext> {
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({ p: products, tz: businesses.timezone, openingHours: businesses.openingHours, policy: businesses.policy, businessId: businesses.id, businessStatus: businesses.status })
    .from(products)
    .innerJoin(businesses, eq(businesses.id, products.businessId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) throw new HttpError(404, "NOT_FOUND");
  // 공개 경로의 게이트는 여기다 — 호출자가 잊을 수 있는 자리에 두지 않는다. 비공개 상품은 존재를 알리지 않고 404
  if (opts.requirePublic && (row.p.status !== "ACTIVE" || row.businessStatus !== "APPROVED")) throw new HttpError(404, "NOT_FOUND");
  const { p, tz } = row;

  const linked = await db.select({ resourceId: productResources.resourceId }).from(productResources).where(eq(productResources.productId, productId));
  const resourceIds = linked.map((x) => x.resourceId);

  const rs: SlotResource[] = resourceIds.length
    ? (await db.select({ id: resources.id, type: resources.type, capacity: resources.capacity, isActive: resources.isActive, sortOrder: resources.sortOrder }).from(resources).where(inArray(resources.id, resourceIds))).map((r) => ({
        id: r.id,
        type: r.type,
        capacity: r.capacity,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
      }))
    : [];

  // 기간에 걸치는 패턴 · 그 기간의 승인된 예외 · 휴무 규칙 전부(반복 전개는 메모리에서)
  const [sched, exceptions, hols] = await Promise.all([
    resourceIds.length
      ? db
          .select()
          .from(workSchedules)
          .where(and(eq(workSchedules.businessId, row.businessId), inArray(workSchedules.resourceId, resourceIds), lte(workSchedules.effectiveFrom, to), or(sql`${workSchedules.effectiveTo} is null`, gte(workSchedules.effectiveTo, from))))
      : Promise.resolve([]),
    resourceIds.length
      ? db
          .select()
          .from(workExceptions)
          .where(and(eq(workExceptions.businessId, row.businessId), inArray(workExceptions.resourceId, resourceIds), eq(workExceptions.status, "APPROVED"), gte(workExceptions.date, addDays(from, -1)), lte(workExceptions.date, to)))
      : Promise.resolve([]),
    holidaysForRange(row.businessId, from, to),
  ]);

  const maxDuration = Math.max(p.durationMin, ...(p.durationOptions ?? []));
  const loadFrom = new Date(localToInstant(from, -(maxDuration + p.bufferBeforeMin + p.bufferAfterMin), tz));
  const loadTo = new Date(localToInstant(addDays(to, 2), 0, tz));
  // 겹침 판정은 점유 구간(버퍼 포함) 그대로 — 같은 자원을 쓰는 **다른 상품**의 긴 버퍼를 이 상품의 여유로 재려다 놓치면 이중 예약이 된다.
  // start_at 하한·상한은 그 술어와 같은 뜻이면서 (resource_id, start_at) 인덱스를 태우려고 덧붙인다
  const scanFrom = new Date(loadFrom.getTime() - MAX_OCCUPY_TAIL_MIN * 60_000);
  const rsv: ExistingReservation[] = resourceIds.length
    ? (
        await db
          .select({ id: reservations.id, resourceId: reservations.resourceId, productId: reservations.productId, startAt: reservations.startAt, endAt: reservations.endAt, bufferBeforeMin: reservations.bufferBeforeMin, bufferAfterMin: reservations.bufferAfterMin, partySize: reservations.partySize, status: reservations.status })
          .from(reservations)
          .where(
            and(
              inArray(reservations.resourceId, resourceIds),
              inArray(reservations.status, ["REQUESTED", "CONFIRMED"]),
              gte(reservations.startAt, scanFrom),
              lt(reservations.startAt, loadTo),
              sql`${reservations.occupyRange} && tstzrange(${loadFrom.toISOString()}::timestamptz, ${loadTo.toISOString()}::timestamptz, '[)')`,
            ),
          )
      ).map((r) => ({
        id: r.id,
        resourceId: r.resourceId,
        productId: r.productId,
        // occupyRange 컬럼(tstzrange)을 그대로 읽지 않고 스냅샷 버퍼로 되만든다 — 드라이버가 range 를 문자열로 주고, 경계 표기가 파싱마다 다르다
        occupyRange: {
          start: new Date(r.startAt.getTime() - r.bufferBeforeMin * 60_000).toISOString(),
          end: new Date(r.endAt.getTime() + r.bufferAfterMin * 60_000).toISOString(),
        },
        partySize: r.partySize,
        status: r.status,
      }))
    : [];

  const ctx: SlotContext = {
    now: now.toISOString(),
    business: {
      timezone: tz,
      openingHours: row.openingHours.map((o) => ({ dow: asDow(o.dow), open: o.open, close: o.close, breaks: o.breaks })),
      policy: mergePolicy(row.policy),
    },
    product: {
      id: p.id,
      startMode: p.startMode,
      fixedStartTimes: (p.fixedStartTimes as FixedStartTimesEntry[] | null) ?? null,
      slotIntervalMin: (p.slotIntervalMin as SlotIntervalMin | null) ?? null,
      durationMin: p.durationMin,
      durationOptions: p.durationOptions ?? null,
      bufferBeforeMin: p.bufferBeforeMin,
      bufferAfterMin: p.bufferAfterMin,
      capacityPerSlot: p.capacityPerSlot,
      maxPartySize: p.maxPartySize,
      resourceSelectMode: p.resourceSelectMode,
      resourceIds,
    },
    resources: rs,
    workSchedules: sched.map(
      (s): WorkSchedule => ({
        resourceId: s.resourceId,
        dayOfWeek: asDow(s.dayOfWeek),
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        breaks: (s.breaks ?? []).map((b) => ({ start: b.start, end: b.end })),
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      }),
    ),
    workExceptions: exceptions.map(
      (e): WorkException => ({
        resourceId: e.resourceId,
        date: e.date,
        kind: e.kind,
        startTime: e.startTime?.slice(0, 5) ?? null,
        endTime: e.endTime?.slice(0, 5) ?? null,
      }),
    ),
    holidays: hols.map(
      (h): Holiday => ({
        resourceId: h.resourceId,
        type: h.type,
        startDate: h.startDate,
        endDate: h.endDate,
        dayOfWeek: h.dayOfWeek,
        dayOfMonth: h.dayOfMonth,
        isLastDayOfMonth: h.isLastDayOfMonth,
        month: h.month,
        isFullDay: h.isFullDay,
        startTime: h.startTime,
        endTime: h.endTime,
        repeatUntil: h.repeatUntil,
      }),
    ),
    existingReservations: rsv,
  };
  return { ctx, businessId: row.businessId };
}
