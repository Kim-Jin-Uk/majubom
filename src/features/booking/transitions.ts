import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbLike } from "@/db/client";
import { products, reservationLogs, reservations, resources } from "@/db/schema";
import type { ReservationStatus } from "@/features/booking/slot-types";
import { HttpError } from "@/features/auth/errors";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { peakOccupancy } from "./peak-occupancy";
import { RULES, type Rule, type TransitionActor } from "./transition-rules";

export type { TransitionActor } from "./transition-rules";

/**
 * 예약 상태 전이 실행 (02 §2.3 전이 규칙 · FR-BOOK-030 승인/거절 · FR-BOOK-040 취소 · FR-BOOK-060 완료/노쇼).
 *
 * 전이는 **표에 있는 것만** 되고, 나머지는 전부 409 `INVALID_TRANSITION` 이다. 표는 `transition-rules.ts` 하나뿐이다 —
 * 라우트가 각자 조건을 들고 있으면 곧 어긋난다.
 *
 * 구현 규약(명세 그대로):
 *   · 갱신은 `WHERE id = ? AND status = <from>` 조건부 UPDATE. 0행이면 409 — 매니저 승인과 고객 취소가 동시에 들어와도 한쪽만 성공한다
 *   · 모든 전이는 ReservationLog 에 from·to·actor·reason 을 남긴다. 사유 필수 전이에 reason 이 없으면 400
 *   · REQUESTED/CONFIRMED 만 슬롯을 점유한다 — 종료 상태로 가면 그 자리가 즉시 열린다
 */

export const transitionInputSchema = z.object({
  status: z.enum(["CONFIRMED", "REJECTED", "CANCELED_BY_BIZ", "COMPLETED", "NO_SHOW"]),
  reason: z.string().trim().max(300, "사유는 300자 이내").optional().nullable(),
});
export type TransitionInput = z.output<typeof transitionInputSchema>;

type Loaded = {
  id: string;
  businessId: string;
  productId: string;
  resourceId: string;
  customerId: string;
  status: ReservationStatus;
  startAt: Date;
  endAt: Date;
  partySize: number;
  exclusive: boolean;
  cancelDeadlineHours: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** 자원에 연결된 매니저 (없으면 null) */
  resourceMemberId: string | null;
  resourceCapacity: number;
  productStatus: string;
};

async function load(id: string, q: DbLike): Promise<Loaded> {
  const [row] = await q
    .select({
      id: reservations.id,
      businessId: reservations.businessId,
      productId: reservations.productId,
      resourceId: reservations.resourceId,
      customerId: reservations.customerId,
      status: reservations.status,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      partySize: reservations.partySize,
      exclusive: reservations.exclusive,
      cancelDeadlineHours: reservations.cancelDeadlineHours,
      bufferBeforeMin: reservations.bufferBeforeMin,
      bufferAfterMin: reservations.bufferAfterMin,
      resourceMemberId: resources.memberId,
      resourceCapacity: resources.capacity,
      productStatus: products.status,
    })
    .from(reservations)
    .innerJoin(resources, eq(resources.id, reservations.resourceId))
    .innerJoin(products, eq(products.id, reservations.productId))
    .where(eq(reservations.id, id))
    .limit(1);
  if (!row) throw new HttpError(404, "NOT_FOUND");
  return row as Loaded;
}

/**
 * 승인 재검증 (FR-BOOK-030). **`computeSlots` 를 쓰면 안 된다** — 그 함수는 신규 예약용이라
 * 예약이 잡힌 뒤 바뀐 상품 설정(격자·이용 시간 옵션)까지 반영해 멀쩡한 예약을 승인 불가로 만든다.
 * 여기서 보는 것은 셋뿐이다: 상품이 살아 있나 · 자원이 있나(isActive 는 보지 않는다 — FR-RES-010 "기존 예약 유지") · 그 자리가 아직 비어 있나.
 *
 * 명세는 "예약 유지로 표시되지 않은 Holiday/WorkException 이 새로 생기지 않았을 것" 도 든다.
 * 우리 구현에서는 이 조건이 항상 참이다 — 겹치는 예약이 있는 휴무·예외는 OWNER 가 `keepReservations`/`confirmConflicts` 로
 * **명시적으로 확인해야만** 등록되기 때문이다(휴무 에픽). 즉 예약 위에 덮인 휴무는 이미 "유지하기로 한" 것이다.
 * 나중에 "일괄 취소" 선택지가 생기면(LATER.md L-11) 그때 플래그를 저장하고 여기서 함께 본다.
 */
export async function validateExisting(r: Loaded, q: DbLike): Promise<void> {
  if (r.productStatus === "ARCHIVED") throw new HttpError(409, "PRODUCT_GONE");
  const occupyStart = new Date(r.startAt.getTime() - r.bufferBeforeMin * 60_000);
  const occupyEnd = new Date(r.endAt.getTime() + r.bufferAfterMin * 60_000);
  const rows = await q
    .select({ start: reservations.startAt, end: reservations.endAt, before: reservations.bufferBeforeMin, after: reservations.bufferAfterMin, partySize: reservations.partySize })
    .from(reservations)
    .where(
      and(
        eq(reservations.resourceId, r.resourceId),
        inArray(reservations.status, ["REQUESTED", "CONFIRMED"]),
        sql`${reservations.id} <> ${r.id}`,
        sql`${reservations.occupyRange} && tstzrange(${occupyStart.toISOString()}::timestamptz, ${occupyEnd.toISOString()}::timestamptz, '[)')`,
      ),
    );
  // 정원은 **자원의 것**만 본다. 상품의 capacityPerSlot 을 끌어오면 사업자가 정원을 줄인 순간 대기 중인 예약이 승인 불가가 된다 —
  // "바뀐 상품 설정으로 기존 예약을 막지 않는다" 는 이 함수의 존재 이유다. 생성 경로가 이미 팀 단위까지 보고 막았다
  if (r.exclusive || r.resourceCapacity === 1) {
    if (rows.length > 0) throw new HttpError(409, "SLOT_TAKEN");
    return;
  }
  const peak = peakOccupancy(
    { start: occupyStart.getTime(), end: occupyEnd.getTime() },
    rows.map((x) => ({ occupyRange: { start: x.start.getTime() - x.before * 60_000, end: x.end.getTime() + x.after * 60_000 }, partySize: x.partySize })),
  );
  if (peak + r.partySize > r.resourceCapacity) throw new HttpError(409, "SLOT_TAKEN", { remaining: Math.max(0, r.resourceCapacity - peak) });
}

/**
 * 볼 수 있는 예약인가 — **규칙을 찾기 전에** 본다. 순서가 반대면 "그런 전이는 안 된다(409 + 현재 상태)" 가
 * 남의 예약에도 나가서, id 를 훑어 남의 예약의 존재와 상태를 알아낼 수 있다. 없는 것과 남의 것은 똑같이 404 다.
 */
function assertVisible(r: Loaded, actor: TransitionActor): void {
  if (actor.kind === "CUSTOMER" && r.customerId !== actor.uid) throw new HttpError(404, "NOT_FOUND");
  if (actor.kind === "CONSOLE" && r.businessId !== actor.businessId) throw new HttpError(404, "NOT_FOUND");
}

function authorize(r: Loaded, actor: TransitionActor, rule: Rule): void {
  if (!rule.by.includes(actor.kind)) throw new HttpError(403, "FORBIDDEN");
  if (actor.kind === "CONSOLE") {
    if (rule.ownerOnly && actor.role !== "OWNER") throw new HttpError(403, "OWNER_ONLY");
    // FR-BOOK-030: OWNER 전체 / MANAGER 는 본인 담당 건만. 담당이 없는 자원(공간·공용)은 OWNER 만 — LATER.md L-32
    if (actor.role !== "OWNER" && r.resourceMemberId !== actor.memberId) throw new HttpError(403, "NOT_OWN_RESOURCE");
  }
}

export type TransitionResult = { id: string; from: ReservationStatus; to: ReservationStatus };

export async function transitionReservation(
  id: string,
  to: ReservationStatus,
  actor: TransitionActor,
  opts: { reason?: string | null; noShowSource?: "MANUAL" | "AUTO"; meta?: RequestMeta; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const r = await load(id, tx);
    assertVisible(r, actor);
    const rule = RULES[`${r.status}>${to}`];
    if (!rule) throw new HttpError(409, "INVALID_TRANSITION", { from: r.status, to });
    authorize(r, actor, rule);
    const reason = opts.reason?.trim() || null;
    if (rule.reasonRequired && !reason) throw new HttpError(400, "REASON_REQUIRED");
    rule.guard?.(r, now);
    if (rule.revalidate) await validateExisting(r, tx);

    // 거절은 취소가 아니다 — canceledAt 에 섞으면 취소 통계가 오염된다. 사유는 어느 쪽이든 로그에 남는다
    const canceled = to === "CANCELED_BY_USER" || to === "CANCELED_BY_BIZ";
    const rows = await tx
      .update(reservations)
      .set({
        status: to,
        ...(canceled ? { canceledAt: now, cancelReason: reason } : {}),
        ...(to === "NO_SHOW" ? { noShowSource: opts.noShowSource ?? (actor.kind === "SYSTEM" ? "AUTO" : "MANUAL") } : {}),
        // 교정으로 COMPLETED 로 돌아오면 노쇼 출처를 지운다 — 지표에서 빠져야 한다
        ...(to === "COMPLETED" && r.status === "NO_SHOW" ? { noShowSource: null } : {}),
      })
      // 조건부 갱신 — 그 사이 다른 쪽이 먼저 바꿨으면 0행이고, 그건 전이 실패다
      .where(and(eq(reservations.id, id), eq(reservations.status, r.status)))
      .returning({ id: reservations.id });
    if (rows.length !== 1) throw new HttpError(409, "INVALID_TRANSITION", { from: r.status, to });

    const actorId = actor.kind === "SYSTEM" ? null : actor.uid;
    await tx.insert(reservationLogs).values({ reservationId: id, fromStatus: r.status, toStatus: to, actorId, reason });
    await writeAudit(
      {
        action: "RESERVATION_STATUS_CHANGE",
        actorId,
        actorRole: actor.kind === "CONSOLE" ? actor.role : actor.kind === "CUSTOMER" ? "CUSTOMER" : "SYSTEM",
        businessId: r.businessId,
        targetType: "RESERVATION",
        targetId: id,
        diff: { status: { from: r.status, to }, reason },
        meta: opts.meta,
      },
      tx,
    );
    return { id, from: r.status, to };
  });
}

/** C2 승인 대기 만료 (5분 주기). `now ≥ min(createdAt + requestExpireHours, startAt − minLeadTimeMin)` */
export async function expireRequests(now = new Date(), limit = 500): Promise<number> {
  const due = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "REQUESTED"),
        sql`${now.toISOString()}::timestamptz >= least(
          ${reservations.createdAt} + ((select coalesce((b.policy->>'requestExpireHours')::int, 24) from businesses b where b.id = ${reservations.businessId}) * interval '1 hour'),
          ${reservations.startAt} - ((select coalesce((b.policy->>'minLeadTimeMin')::int, 60) from businesses b where b.id = ${reservations.businessId}) * interval '1 minute')
        )`,
      ),
    )
    .orderBy(reservations.startAt)
    .limit(limit);
  let n = 0;
  for (const row of due) {
    try {
      await transitionReservation(row.id, "EXPIRED", { kind: "SYSTEM" }, { now });
      n++;
    } catch (e) {
      // 그 사이 고객이 취소했거나 매니저가 승인한 건 — 조건부 UPDATE 가 0행을 내고 여기로 온다. 배치는 계속 돈다
      if (e instanceof HttpError && e.status === 409) continue;
      throw e;
    }
  }
  return n;
}

/**
 * C3 노쇼 자동 전환 (일 1회). `now ≥ endAt + autoNoShowAfterHours`.
 * 명세의 "사업자가 끌 수 있음" 은 아직 없다 — `policy` 에 on/off 키가 없어서다(README "아직 안 한 것").
 */
export async function autoNoShow(now = new Date(), limit = 500): Promise<number> {
  const due = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "CONFIRMED"),
        lt(reservations.endAt, now),
        sql`${now.toISOString()}::timestamptz >= ${reservations.endAt} + ((select coalesce((b.policy->>'autoNoShowAfterHours')::int, 24) from businesses b where b.id = ${reservations.businessId}) * interval '1 hour')`,
      ),
    )
    .orderBy(reservations.endAt)
    .limit(limit);
  let n = 0;
  for (const row of due) {
    try {
      await transitionReservation(row.id, "NO_SHOW", { kind: "SYSTEM" }, { now, noShowSource: "AUTO" });
      n++;
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) continue;
      throw e;
    }
  }
  return n;
}

/**
 * FR-BOOK-040 남용 방지 — 같은 사업장에서 오늘 3건 초과 취소한 고객은 당일 재예약을 막는다.
 * **예약 변경으로 취소된 건은 세지 않는다** — 변경은 취소가 아니고(새 예약이 그 자리를 대신 잡았다), 시간을 몇 번 옮긴 고객을 막으면 안 된다.
 */
export async function canceledTodayCount(businessId: string, customerId: string, since: Date, q: DbLike = db): Promise<number> {
  const [row] = await q
    .select({ n: count() })
    .from(reservations)
    .where(
      and(
        eq(reservations.businessId, businessId),
        eq(reservations.customerId, customerId),
        eq(reservations.status, "CANCELED_BY_USER"),
        gte(reservations.canceledAt, since),
        sql`not exists (select 1 from reservations later where later.replaces_reservation_id = ${reservations.id})`,
      ),
    );
  return row?.n ?? 0;
}
