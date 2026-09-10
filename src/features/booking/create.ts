import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { reservationLogs, reservations, type BusinessPolicy } from "@/db/schema";
import { HttpError, pgCode } from "@/features/auth/errors";
import { addDays } from "@/features/schedule/resolve";
import { todayIn } from "@/lib/dates";
import { newReservationCode } from "./code";
import { loadBookingContext, loadProductTimezone } from "./context";
import { peakOccupancy } from "./peak-occupancy";
import { computeSlots, dateInRange, fixedStartMinutes } from "./slots";
import { canceledTodayCount } from "./transitions";
import { isSlotFailure, type Slot, type SlotContext } from "./slot-types";
import { localToInstant, toMs } from "./time";

/**
 * FR-BOOK-020 예약 생성. 명세 7단계를 그대로 따른다:
 *   1 입력 검증 · 2 정책 · 3 슬롯 재검증(FR-BOOK-010 로직 재사용) · 3.5 자원 배정 · 4 트랜잭션+락+제약 · 5 상태 · 6 코드 · 7 로그
 *
 * **프론트 결과를 믿지 않는다.** 3단계는 `computeSlots` 를 그대로 다시 불러 그 시각이 지금도 유효한지 본다 —
 * 같은 순수 함수라 조회와 생성이 어긋날 수 없다.
 *
 * 동시성은 정원에 따라 두 갈래다(명세 "동시성 제어"):
 *   · `exclusive = (resource.capacity = 1)` → DB 배타 제약 `no_overlap` 이 겹침을 거부한다. 23P01 이면 다음 후보로
 *   · 정원 N → 제약으로 표현할 수 없다. `pg_advisory_xact_lock(resource)` 로 자원 단위 직렬화 후 점유를 **다시 세고** INSERT
 * 고객 동시 예약 한도도 check-then-act 라 `pg_advisory_xact_lock('cust:'||customerId)` 안에서 센다.
 * 락 순서는 언제나 **고객 → 자원** 이다(반대로 잡는 경로가 없어야 데드락이 안 생긴다). 그래도 40P01 이면 한 번 재시도한다.
 */

/** 하루에 이만큼을 **넘겨** 취소하면 당일 재예약이 막힌다 (FR-BOOK-040 남용 방지) */
const CANCEL_ABUSE_LIMIT = 3;

export const createReservationSchema = z.object({
  productId: z.uuid(),
  /** 오프셋을 가진 ISO 8601. 슬롯 조회가 돌려준 `start` 를 그대로 보낸다 */
  startAt: z.string().min(1),
  partySize: z.number().int().min(1, "인원은 1명 이상").max(500),
  /** durationOptions 가 있는 상품만 의미 있다 */
  durationMin: z.number().int().positive().optional(),
  /** REQUIRED 는 필수, OPTIONAL 은 선택. AUTO·NONE 은 보내도 무시하지 않고 후보를 그 자원으로 좁힌다 */
  resourceId: z.uuid().optional(),
  customerNote: z.string().trim().max(500, "요청사항은 500자 이내").optional().nullable(),
  /** 예약 변경 (FR-BOOK-050) — 이 예약을 대체한다. 원 예약은 같은 트랜잭션에서 취소된다 */
  replacesReservationId: z.uuid().optional(),
});
export type CreateReservationInput = z.output<typeof createReservationSchema>;

/** 워크인 대리 등록 (FR-BOOK-070). 자원과 이름을 콘솔이 직접 넣는다 */
export const walkInSchema = z.object({
  productId: z.uuid(),
  resourceId: z.uuid(),
  startAt: z.string().min(1),
  partySize: z.number().int().min(1).max(500),
  durationMin: z.number().int().positive().optional(),
  guestLabel: z.string().trim().min(1, "이름을 입력해 주세요").max(60, "이름은 60자 이내"),
  internalMemo: z.string().trim().max(500, "메모는 500자 이내").optional().nullable(),
});
export type WalkInInput = z.output<typeof walkInSchema>;

export type CreatedReservation = { id: string; code: string; status: "REQUESTED" | "CONFIRMED"; resourceId: string; startAt: Date; endAt: Date };

/** 경로마다 다른 것 — 정책을 얼마나 우회하는가, 무엇으로 기록하는가 */
type PlaceMode = {
  /** WEB(고객) · WALK_IN(콘솔 대리) */
  via: "WEB" | "WALK_IN";
  /** 선행시간·예약 가능일·1인 한도·취소 남용을 건너뛴다 (워크인 — 현장 접수라 정책 대상이 아니다) */
  bypassPolicy: boolean;
  guestLabel?: string | null;
  internalMemo?: string | null;
  /** 변경이면 대체되는 원 예약 id */
  replaces?: string;
  /** 강제로 REQUESTED 로 (취소 마감을 지난 변경) */
  forceRequested?: boolean;
  /** 콘솔 경로 — 이 사업장 상품이 아니면 404. 공개 경로는 게이트(requirePublic)가 대신한다 */
  expectBusinessId?: string;
};

/** 실패 응답에 함께 주는 대체 시각 — 같은 날 가장 가까운 것 3개 (FR-BOOK-020 "409 SLOT_TAKEN + 대체 시각 3개") */
function nearest(slots: Slot[], wantedMs: number, n = 3): string[] {
  // 방금 실패한 그 시각은 대체가 아니다 — 거리 0 이라 정렬하면 1순위로 올라온다
  return slots
    .filter((s) => toMs(s.start) !== wantedMs)
    .sort((a, b) => Math.abs(toMs(a.start) - wantedMs) - Math.abs(toMs(b.start) - wantedMs))
    .slice(0, n)
    .map((s) => s.start);
}

/** 그 시각이 이 상품의 시작 시각이 될 수 있는가 — FREE 는 격자에 맞는지, FIXED 는 그날 회차인지 (구간·정원은 보지 않는다) */
function onGrid(ctx: SlotContext, date: string, wantedMs: number): boolean {
  const tz = ctx.business.timezone;
  const minutes = (wantedMs - localToInstant(date, 0, tz)) / 60_000;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 2880) return false;
  if (ctx.product.startMode === "FIXED") return fixedStartMinutes(ctx, date).includes(minutes);
  return ctx.product.slotIntervalMin !== null && minutes % ctx.product.slotIntervalMin === 0;
}

/** 그 시각이 지금도 유효한 슬롯인가 — 영업일이 자정을 넘길 수 있어 전날 영업일도 함께 본다 */
function findSlot(ctx: SlotContext, dates: string[], input: CreateReservationInput, resourceId?: string): { date: string; slot: Slot; all: Slot[] } | { error: string; all: Slot[] } {
  const wanted = toMs(input.startAt);
  let all: Slot[] = [];
  for (const date of dates) {
    const r = computeSlots(ctx, { date, partySize: input.partySize, durationMin: input.durationMin, resourceId });
    if (isSlotFailure(r)) return { error: r.error, all: [] };
    all = all.concat(r.slots);
    const slot = r.slots.find((s) => toMs(s.start) === wanted);
    if (slot) return { date, slot, all };
  }
  return { error: "SLOT_TAKEN", all };
}

export async function createReservation(input: CreateReservationInput, customer: { uid: string }, now = new Date()): Promise<CreatedReservation> {
  if (!input.replacesReservationId) return place(input, customer.uid, { via: "WEB", bypassPolicy: false }, now);
  return changeReservation(input, customer.uid, now);
}

/**
 * FR-BOOK-070 워크인 대리 등록. 정책(선행시간·예약 가능일·1인 한도·취소 남용)은 우회하되 **자원 시간 충돌 검증은 동일**하다 —
 * 그래서 정책 두 값만 느슨하게 바꾼 컨텍스트로 같은 `computeSlots` 를 돌린다. 격자·회차는 그대로 지킨다(콘솔이 슬롯을 보여 주고 고르게 한다).
 * 고객은 사업장별 워크인 내부 계정이고 이름은 `guestLabel` 에 표시용으로만 남는다. 즉시 CONFIRMED.
 */
export async function createWalkIn(input: WalkInInput, walkIn: { customerId: string; businessId: string }, now = new Date()): Promise<CreatedReservation> {
  return place(
    { productId: input.productId, startAt: input.startAt, partySize: input.partySize, durationMin: input.durationMin, resourceId: input.resourceId, customerNote: null },
    walkIn.customerId,
    { via: "WALK_IN", bypassPolicy: true, guestLabel: input.guestLabel, internalMemo: input.internalMemo ?? null, expectBusinessId: walkIn.businessId },
    now,
  );
}

/** 변경 경로가 미리 읽어 둔 컨텍스트 (원 예약을 점유에서 뺀 상태) */
type Prepared = { ctx: SlotContext; businessId: string; tz: string };

async function place(input: CreateReservationInput, customerId: string, mode: PlaceMode, now: Date, prepared?: Prepared): Promise<CreatedReservation> {
  const wantedMs = toMs(input.startAt);
  if (Number.isNaN(wantedMs)) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["startAt"], message: "오프셋을 가진 ISO 8601 이어야 합니다" }] });

  // 3) 슬롯 재검증 — 자정을 넘겨 영업하는 날이 있으므로 시작 시각이 속할 수 있는 영업일 둘을 본다
  const requirePublic = mode.via === "WEB";
  const tz = prepared?.tz ?? (await loadProductTimezone(input.productId, { requirePublic }));
  const day = todayIn(tz, new Date(wantedMs));
  const dates = [addDays(day, -1), day];
  const loaded = prepared ?? (await loadBookingContext(input.productId, dates[0], dates[1], { now, requirePublic }));
  const businessId = loaded.businessId;
  // 콘솔 경로는 공개 게이트를 타지 않으므로 여기서 사업장을 확인한다 — 없으면 남의 사업장에 예약을 만들 수 있다
  if (mode.expectBusinessId && businessId !== mode.expectBusinessId) throw new HttpError(404, "NOT_FOUND");
  // 워크인은 선행시간·예약 가능일을 우회한다 (현장 접수). 나머지(영업시간·근무표·휴무·정원)는 그대로 본다
  const ctx: SlotContext = mode.bypassPolicy
    ? { ...loaded.ctx, business: { ...loaded.ctx.business, policy: { ...loaded.ctx.business.policy, minLeadTimeMin: 0, maxAdvanceDays: 365 } } }
    : loaded.ctx;

  const found = findSlot(ctx, dates, input, input.resourceId);
  if ("error" in found) {
    if (found.error !== "SLOT_TAKEN") throw new HttpError(400, found.error);
    // 1) 애초에 시작 시각이 될 수 없는 값(격자 밖·회차 아님)은 "누가 채갔다" 가 아니라 잘못된 입력이다
    if (!dates.some((d) => onGrid(ctx, d, wantedMs))) throw new HttpError(400, "INVALID_START_TIME");
    // 2) 정책 위반도 마찬가지 — 위젯이 다른 문구를 보여줄 수 있게 구분해서 돌려준다.
    //    우회 경로(워크인)에서는 이 판정을 하면 안 된다: 자리가 찬 것을 "선행시간 미달" 로 잘못 알려 충돌을 감춘다
    if (!mode.bypassPolicy) {
      const policy = loaded.ctx.business.policy;
      if (wantedMs < now.getTime() + policy.minLeadTimeMin * 60_000) throw new HttpError(400, "LEAD_TIME", { minLeadTimeMin: policy.minLeadTimeMin });
      // 조회와 **같은 함수**로 판정한다. 따로 적어 두면 언젠가 한쪽만 고쳐져
      // "위젯에는 보이는데 예약은 안 되는 시각" 이 생긴다 — 지금 영업 중인 어제(가정 A7)가 바로 그 자리였다
      if (!dates.some((d) => dateInRange(ctx.business, d, now.getTime()))) throw new HttpError(400, "OUT_OF_RANGE", { maxAdvanceDays: policy.maxAdvanceDays });
    }
    throw new HttpError(409, "SLOT_TAKEN", { alternatives: nearest(found.all, wantedMs) });
  }
  const { date, slot } = found;
  const durationMs = toMs(slot.end) - toMs(slot.start);

  // 3.5) 자원 배정 — 후보를 순서대로 시도한다. 합산 잔여만 보고 들어온 요청이 특정 자원에서만 실패하는 것을 막기 위해서다 (LATER.md L-31)
  const byId = new Map(ctx.resources.map((r) => [r.id, r]));
  const perResource = slot.resourceIds
    .map((id) => {
      const one = computeSlots(ctx, { date, partySize: input.partySize, durationMin: input.durationMin, resourceId: id });
      const s = isSlotFailure(one) ? undefined : one.slots.find((x) => toMs(x.start) === wantedMs);
      return s ? { id, remaining: s.remaining } : null;
    })
    .filter((x): x is { id: string; remaining: number } => x !== null);
  if (perResource.length === 0) throw new HttpError(409, "SLOT_TAKEN", { alternatives: nearest(found.all, wantedMs) });

  // 그날 확정 건수 — 부하 분산용 정렬 키
  const load = new Map<string, number>();
  for (const row of await db
    .select({ resourceId: reservations.resourceId, n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(inArray(reservations.resourceId, perResource.map((x) => x.id)), eq(reservations.status, "CONFIRMED"), gte(reservations.startAt, new Date(toMs(slot.start) - 86_400_000))))
    .groupBy(reservations.resourceId))
    load.set(row.resourceId, row.n);

  const candidates = perResource.sort(
    (a, b) => b.remaining - a.remaining || (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || (byId.get(a.id)?.sortOrder ?? 0) - (byId.get(b.id)?.sortOrder ?? 0) || a.id.localeCompare(b.id),
  );

  const policy = loaded.ctx.business.policy as unknown as BusinessPolicy;
  for (const cand of candidates) {
    const resource = byId.get(cand.id)!;
    try {
      return await withDeadlockRetry(() => insertOne(ctx, businessId, input, cand.id, resource.capacity, customerId, policy, new Date(wantedMs), new Date(wantedMs + durationMs), now, tz, mode));
    } catch (e) {
      // 배타 제약 위반·락 후 재계산 실패는 "이 자원은 방금 찼다" 는 뜻 — 다음 후보로 넘어간다
      if (pgCode(e) === "23P01" || (e instanceof HttpError && e.code === "SLOT_TAKEN")) continue;
      throw e;
    }
  }
  // 후보를 전부 시도했는데 다 찼다
  throw new HttpError(409, "SLOT_TAKEN", { alternatives: nearest(found.all, wantedMs) });
}

/**
 * FR-BOOK-050 예약 변경. 화면에선 한 단계지만 서버는 **새 예약 + `replacesReservationId`** 다.
 * 취소 후 재예약을 안내만 하면 (1) 같은 시각 이용 시간 연장이 자기 자신과 충돌해 늘 409, (2) 한도를 채운 고객은 변경 불가,
 * (3) 취소 마감 안에서는 변경도 불가 — 셋 다 막힌다.
 *
 * 원 예약은 점유 계산에서 빼고(같은 자리로 옮기는 것이 가능해야 한다) 트랜잭션 안에서 먼저 취소한다.
 * 취소 마감을 지난 변경은 `autoConfirm` 과 무관하게 `REQUESTED` 로 만들어 매장 승인을 받는다.
 * 실패하면 전체 롤백 — 원 예약은 그대로 살아 있다.
 */
async function changeReservation(input: CreateReservationInput, customerId: string, now: Date): Promise<CreatedReservation> {
  const oldId = input.replacesReservationId!;
  const [old] = await db
    .select({
      id: reservations.id,
      productId: reservations.productId,
      status: reservations.status,
      startAt: reservations.startAt,
      cancelDeadlineHours: reservations.cancelDeadlineHours,
    })
    .from(reservations)
    .where(and(eq(reservations.id, oldId), eq(reservations.customerId, customerId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"])))
    .limit(1);
  // 남의 예약·이미 끝난 예약은 존재를 알리지 않는다
  if (!old) throw new HttpError(404, "NOT_FOUND");
  if (old.productId !== input.productId) throw new HttpError(400, "PRODUCT_MISMATCH");
  // 이미 시작한 예약을 미래로 "변경" 하면 취소 마감과 노쇼 기록을 우회하게 된다
  if (old.startAt <= now) throw new HttpError(400, "ALREADY_STARTED");

  const wantedMs = toMs(input.startAt);
  if (Number.isNaN(wantedMs)) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["startAt"], message: "오프셋을 가진 ISO 8601 이어야 합니다" }] });
  const tz = await loadProductTimezone(input.productId, { requirePublic: true });
  const day = todayIn(tz, new Date(wantedMs));
  const dates = [addDays(day, -1), day];
  const loaded = await loadBookingContext(input.productId, dates[0], dates[1], { now, requirePublic: true });
  // 원 예약은 곧 취소될 것이므로 점유에서 뺀다 — 이게 없으면 "같은 시각 60분 → 120분" 이 자기 자신과 충돌한다
  const prepared: Prepared = { ...loaded, tz, ctx: { ...loaded.ctx, existingReservations: loaded.ctx.existingReservations.filter((r) => r.id !== oldId) } };

  // 취소 마감을 지났으면 승인을 받는다 (마감 뒤 변경을 막으면 고객이 전화하게 된다 — 기획서 P1 회귀)
  const pastDeadline = now.getTime() >= old.startAt.getTime() - old.cancelDeadlineHours * 3_600_000;
  return place(input, customerId, { via: "WEB", bypassPolicy: false, replaces: oldId, forceRequested: pastDeadline }, now, prepared);
}

async function withDeadlockRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // 40P01 은 서로 다른 순서로 락을 잡았을 때다. 한 번만 다시 — 계속 재시도하면 폭주한다
    if (pgCode(e) !== "40P01") throw e;
    return fn();
  }
}

async function insertOne(
  ctx: SlotContext,
  businessId: string,
  input: CreateReservationInput,
  resourceId: string,
  resourceCapacity: number,
  customerId: string,
  policy: BusinessPolicy,
  startAt: Date,
  endAt: Date,
  now: Date,
  tz: string,
  mode: PlaceMode,
): Promise<CreatedReservation> {
  const p = ctx.product;
  const durationMin = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
  const occupyStart = new Date(startAt.getTime() - p.bufferBeforeMin * 60_000);
  const occupyEnd = new Date(endAt.getTime() + p.bufferAfterMin * 60_000);
  // 명세: exclusive 는 "생성 시점 자원 기준" 스냅샷이다. capacityPerSlot 이 1 이어도 자원 정원이 N 이면 배타 제약을 쓸 수 없다(다른 상품이 같은 자원을 N 으로 쓴다)
  const exclusive = resourceCapacity === 1;
  const cap = Math.min(p.capacityPerSlot, resourceCapacity);
  // 워크인은 즉시 확정. 취소 마감을 지난 변경은 autoConfirm 과 무관하게 매장 승인을 받는다 (FR-BOOK-050)
  const status = mode.via === "WALK_IN" ? "CONFIRMED" : mode.forceRequested || !policy.autoConfirm ? "REQUESTED" : "CONFIRMED";

  return db.transaction(async (tx) => {
    // 락 순서는 언제나 고객 → 자원
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cust:${customerId}`}))`);

    // 변경이면 원 예약을 **먼저** 취소한다 — 같은 트랜잭션이라 실패하면 통째로 되돌아간다.
    // 순서가 중요하다: 원 예약이 살아 있으면 자기 자신과 겹쳐(이용 시간 연장 등) 배타 제약·재계산에 늘 걸린다
    if (mode.replaces) {
      const [old] = await tx
        .select({ id: reservations.id, status: reservations.status })
        .from(reservations)
        .where(and(eq(reservations.id, mode.replaces), eq(reservations.customerId, customerId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"])))
        .for("update");
      if (!old) throw new HttpError(404, "NOT_FOUND");
      const canceled = await tx
        .update(reservations)
        .set({ status: "CANCELED_BY_USER", canceledAt: now, cancelReason: "예약 변경" })
        .where(and(eq(reservations.id, old.id), eq(reservations.status, old.status)))
        .returning({ id: reservations.id });
      if (canceled.length !== 1) throw new HttpError(409, "INVALID_TRANSITION");
      await tx.insert(reservationLogs).values({ reservationId: old.id, fromStatus: old.status, toStatus: "CANCELED_BY_USER", actorId: customerId, reason: "예약 변경" });
    }

    if (!mode.bypassPolicy) {
      // 한도는 사업장 단위(정책이 사업장 것이다) · **앞으로의** 예약만 센다 —
      // 지난 예약은 상태 전이(COMPLETED·EXPIRED)가 늦어질 수 있고, 그게 고객을 영구히 막으면 안 된다.
      // 변경이면 원 예약은 위에서 이미 취소돼 자연히 빠진다
      const [{ n: active }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(reservations)
        .where(and(eq(reservations.customerId, customerId), eq(reservations.businessId, businessId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gte(reservations.startAt, now)));
      if (active >= policy.maxActivePerCustomer) throw new HttpError(409, "TOO_MANY_ACTIVE", { limit: policy.maxActivePerCustomer });
      // 남용 방지 (FR-BOOK-040): 같은 사업장에서 오늘 3건을 넘겨 취소한 고객은 당일 재예약을 막는다. 같은 고객 락 안이라 경쟁이 없다
      // "당일" 은 사업장 타임존의 달력 하루다 (24시간 롤링이 아니다 — 어젯밤 취소가 다음 날 아침을 막으면 안 된다)
      const since = new Date(localToInstant(todayIn(tz, now), 0, tz));
      if ((await canceledTodayCount(businessId, customerId, since, tx)) > CANCEL_ABUSE_LIMIT) throw new HttpError(409, "CANCEL_ABUSE", { limit: CANCEL_ABUSE_LIMIT });
    }

    {
      // 자원 단위로 직렬화하고 점유를 다시 센다. 정원 N 은 제약으로 표현할 수 없고(Σ partySize ≤ capacity 는 쌍 단위 겹침 검사가 아니다),
      // 정원 1 도 배타 제약만으로는 부족하다 — 술어가 `exclusive AND …` 라 자원 정원을 N→1 로 바꾼 뒤 남은 exclusive=false 행과는 비교되지 않는다.
      // FOR UPDATE 로도 부족하다: 아직 아무 예약이 없는 회차에 동시에 들어온 둘이 서로를 못 본다(팬텀).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${resourceId}))`);
      const rows = await tx
        .select({ start: reservations.startAt, end: reservations.endAt, before: reservations.bufferBeforeMin, after: reservations.bufferAfterMin, partySize: reservations.partySize })
        .from(reservations)
        .where(and(eq(reservations.resourceId, resourceId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), sql`${reservations.occupyRange} && tstzrange(${occupyStart.toISOString()}::timestamptz, ${occupyEnd.toISOString()}::timestamptz, '[)')`));
      const peak = peakOccupancy(
        { start: occupyStart.getTime(), end: occupyEnd.getTime() },
        rows.map((r) => ({ occupyRange: { start: r.start.getTime() - r.before * 60_000, end: r.end.getTime() + r.after * 60_000 }, partySize: r.partySize })),
      );
      // 정원 1(팀 단위)이면 한 건이라도 있으면 찬 것이다 (가정 A1)
      const remaining = cap === 1 ? (peak > 0 ? 0 : 1) : cap - peak;
      if (remaining < (cap === 1 ? 1 : input.partySize)) throw new HttpError(409, "SLOT_TAKEN");
    }

    // 예약번호는 unique — 부딪히면 다시 뽑는다. 예외로 잡으면 안 된다: PG 는 첫 에러로 트랜잭션을 aborted 로 만들고
    // 이후 문장은 전부 25P02 라 재시도가 불가능하다(drizzle 최상위 transaction 은 문장별 savepoint 를 만들지 않는다). 그래서 onConflictDoNothing 으로 본다
    for (let attempt = 0; ; attempt++) {
      const code = newReservationCode();
      {
        const rowsIns = await tx
          .insert(reservations)
          .values({
            code,
            businessId,
            productId: p.id,
            resourceId,
            customerId,
            startAt,
            endAt,
            occupyRange: sql`tstzrange(${occupyStart.toISOString()}::timestamptz, ${occupyEnd.toISOString()}::timestamptz, '[)')`,
            exclusive,
            durationMin,
            bufferBeforeMin: p.bufferBeforeMin,
            bufferAfterMin: p.bufferAfterMin,
            // 정책은 생성 시점 스냅샷 — 나중에 사업자가 마감을 늘려도 이 예약의 조건은 그대로다 (FR-BIZ-020)
            cancelDeadlineHours: policy.cancelDeadlineHours,
            partySize: input.partySize,
            status,
            customerNote: input.customerNote || null,
            internalMemo: mode.internalMemo || null,
            guestLabel: mode.guestLabel || null,
            replacesReservationId: mode.replaces ?? null,
            createdVia: mode.via,
          })
          .onConflictDoNothing({ target: reservations.code })
          .returning({ id: reservations.id, startAt: reservations.startAt, endAt: reservations.endAt });
        const row = rowsIns[0];
        if (!row) {
          if (attempt < 4) continue;
          throw new HttpError(409, "CONFLICT");
        }
        // 상태 변경은 전부 ReservationLog 에 남는다 (FR-ADM-040). 생성은 fromStatus 가 null
        await tx.insert(reservationLogs).values({ reservationId: row.id, fromStatus: null, toStatus: status, toResourceId: resourceId, actorId: customerId, reason: mode.replaces ? `예약 변경: ${mode.replaces} 대체` : null });
        return { id: row.id, code, status, resourceId, startAt: row.startAt, endAt: row.endAt };
      }
    }
  });
}
