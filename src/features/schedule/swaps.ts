import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, type DbLike } from "@/db/client";
import { businesses, businessMembers, productResources, products, reservationLogs, reservations, resources, shiftSwapRequests, users, workExceptions } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { notifyReservation } from "@/features/booking/notify";
import { peakOccupancy } from "@/features/booking/peak-occupancy";
import { writeAudit } from "@/lib/audit";
import { isoDateSchema as dateSchema, todayIn } from "@/lib/dates";
import type { RequestMeta } from "@/lib/request-meta";
import { holidaysForRange } from "./holidays";
import { applicable, listExceptions } from "./work-exceptions";
import { fmtMin, resolveWorkDay, type Interval } from "./resolve";
import { isSwapOpen, SWAP_EXPIRE_HOURS, SWAP_RULES, snapshotKey, swapLegs, type SwapAction, type SwapSeat, type SwapShape, type SwapStatus } from "./swap-rules";
import { schedulesForRange } from "./work-schedules";

/**
 * 근무 교대 (FR-SHIFT-010/020/030, #43~#46). 순수한 부분(전이 표·방향 분해)은 `swap-rules.ts`.
 *
 * 이 파일이 지키는 것은 하나다: **근무표만 바뀌고 예약은 그대로 남는 상태를 만들지 않는다** (리스크 R4).
 * 그래서 이관 가능 여부를 **트랜잭션을 시작하기 전에** 전부 판정하고(`planSwap`), 하나라도 실패하면
 * 상태를 건드리지 않는다. 먼저 근무표를 바꿔 놓고 이관에서 실패하면 되돌릴 사람이 없다.
 */

export type SwapActor = { uid: string; role: "OWNER" | "MANAGER"; memberId: string };

export const swapInputSchema = z
  .object({
    targetResourceId: z.uuid(),
    requestDate: dateSchema,
    swapType: z.enum(["GIVE", "EXCHANGE"]),
    targetDate: dateSchema.nullable().optional(),
    reason: z.string().trim().min(1, "사유를 적어 주세요").max(300, "사유는 300자 이내"),
    /** 요청자의 requestDate 예약을 대상에게 넘길지. false 면 그 시간만 요청자가 나온다 */
    reassignRequester: z.boolean(),
    /** EXCHANGE 일 때 대상의 targetDate 예약을 요청자에게 넘길지 */
    reassignTarget: z.boolean().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.swapType === "EXCHANGE" && !v.targetDate) ctx.addIssue({ code: "custom", path: ["targetDate"], message: "맞교대는 상대 근무일이 필요합니다" });
    if (v.swapType === "EXCHANGE" && v.targetDate === v.requestDate && v.reassignTarget === undefined) {
      ctx.addIssue({ code: "custom", path: ["reassignTarget"], message: "같은 날 맞교대는 양쪽 예약 처리를 모두 정해야 합니다" });
    }
  });
export type SwapInput = z.output<typeof swapInputSchema>;

export const swapActionSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT", "CANCEL", "APPROVE", "DENY"]),
  /** 고객이 담당자를 직접 지정한 예약을 옮길 때 한 번 더 받는 확인 (FR-SHIFT-030) */
  confirmDirectPicks: z.boolean().optional(),
});
export type SwapActionInput = z.output<typeof swapActionSchema>;

type Row = typeof shiftSwapRequests.$inferSelect;

export type SwapItem = {
  id: string;
  status: SwapStatus;
  swapType: "GIVE" | "EXCHANGE";
  requestDate: string;
  targetDate: string | null;
  requesterResourceId: string;
  requesterName: string;
  targetResourceId: string;
  targetName: string;
  reason: string;
  reassignRequester: boolean;
  reassignTarget: boolean | null;
  reservationCount: number;
  createdAt: Date;
  /** 응답이 없으면 이 시각에 자동 만료 (PENDING 만) */
  expiresAt: Date | null;
  /** 이 사람이 지금 할 수 있는 것 */
  can: SwapAction[];
};

const shapeOf = (r: Row): SwapShape => ({
  swapType: r.swapType,
  requesterResourceId: r.requesterResourceId,
  targetResourceId: r.targetResourceId,
  requestDate: r.requestDate,
  targetDate: r.targetDate,
  reassignRequester: r.reassignRequester,
  reassignTarget: r.reassignTarget,
});

const expiresAt = (r: Row): Date | null => (r.status === "PENDING" ? new Date(r.createdAt.getTime() + SWAP_EXPIRE_HOURS * 3_600_000) : null);

/** 매니저 본인 계정이 연결된 STAFF 자원 (없으면 null) */
async function myResource(businessId: string, memberId: string, q: DbLike = db): Promise<string | null> {
  const [r] = await q.select({ id: resources.id }).from(resources).where(and(eq(resources.businessId, businessId), eq(resources.memberId, memberId))).limit(1);
  return r?.id ?? null;
}

/**
 * 그 요청에서 이 사람이 앉은 자리들. 사장님이 당사자이기도 할 수 있어 **여러 개**다 —
 * 하나만 고르면 "사장님이면서 요청자" 인 사람이 자기 요청을 철회하지 못하거나, 반대로 대상 자리를 가로챈다.
 */
function seatsOf(r: Row, actor: SwapActor, mine: string | null): SwapSeat[] {
  const seats: SwapSeat[] = [];
  if (mine && mine === r.requesterResourceId) seats.push("REQUESTER");
  if (mine && mine === r.targetResourceId) seats.push("TARGET");
  if (actor.role === "OWNER") seats.push("OWNER");
  return seats;
}

function allowed(r: Row, seats: SwapSeat[], autoApprove: boolean): SwapAction[] {
  return (Object.keys(SWAP_RULES) as SwapAction[]).filter((a) => {
    const rule = SWAP_RULES[a];
    if (a === "EXPIRE") return false; // 배치 전용
    if (!rule.from.includes(r.status)) return false;
    if (a === "APPROVE" && seats.includes("TARGET") && !seats.includes("OWNER") && !autoApprove) return false;
    return rule.by.some((s) => seats.includes(s));
  });
}

/** 목록 — 당사자이거나 사장님인 것만. 남의 교대 사정은 남의 일이다 (FR-SCH-030 과 같은 기준) */
export async function listSwaps(businessId: string, actor: SwapActor, opts: { openOnly?: boolean } = {}): Promise<SwapItem[]> {
  const autoApprove = await autoApproveOf(businessId);
  const mine = await myResource(businessId, actor.memberId);
  const rq = alias(resources, "rq");
  const tg = alias(resources, "tg");
  const rows = await db
    .select({ r: shiftSwapRequests, requesterName: rq.name, targetName: tg.name })
    .from(shiftSwapRequests)
    .innerJoin(rq, eq(rq.id, shiftSwapRequests.requesterResourceId))
    .innerJoin(tg, eq(tg.id, shiftSwapRequests.targetResourceId))
    .where(eq(shiftSwapRequests.businessId, businessId))
    .orderBy(desc(shiftSwapRequests.createdAt));
  return rows
    .filter(({ r }) => actor.role === "OWNER" || (mine !== null && (r.requesterResourceId === mine || r.targetResourceId === mine)))
    .filter(({ r }) => !opts.openOnly || isSwapOpen(r.status))
    .map(({ r, requesterName, targetName }) => toItem(r, requesterName, targetName, allowed(r, seatsOf(r, actor, mine), autoApprove)));
}

function toItem(r: Row, requesterName: string, targetName: string, can: SwapAction[]): SwapItem {
  return {
    id: r.id,
    status: r.status,
    swapType: r.swapType,
    requestDate: r.requestDate,
    targetDate: r.targetDate,
    requesterResourceId: r.requesterResourceId,
    requesterName,
    targetResourceId: r.targetResourceId,
    targetName,
    reason: r.reason,
    reassignRequester: r.reassignRequester,
    reassignTarget: r.reassignTarget,
    reservationCount: r.reservationIdsAtRequest.length,
    createdAt: r.createdAt,
    expiresAt: expiresAt(r),
    can,
  };
}

async function autoApproveOf(businessId: string, q: DbLike = db): Promise<boolean> {
  const [b] = await q.select({ policy: businesses.policy }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  return b.policy.shiftAutoApprove === true;
}

/**
 * 그 자원이 **그날 시작하는** 예약. 교대는 "그날 근무" 를 넘기는 것이므로 전날 저녁에 시작해
 * 자정을 넘겨 들어온 예약은 전날 근무에 속한다 — 여기 넣으면 두 날의 교대가 같은 예약을 두 번 다룬다.
 */
export type SwapReservation = {
  id: string;
  code: string;
  productId: string;
  resourceId: string;
  partySize: number;
  startAt: Date;
  endAt: Date;
  exclusive: boolean;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** 사업장 벽시계 기준 그날 00:00 부터의 분. 자정을 넘기면 endMin 이 1440 을 넘는다 */
  startMin: number;
  endMin: number;
  customerName: string | null;
  /** 고객이 담당자를 직접 골라야 하는 상품 — 옮길 때 확인을 한 번 더 받는다 (FR-SHIFT-030) */
  directPick: boolean;
};

async function reservationsOnShift(businessId: string, date: string, resourceId: string, tz: string, q: DbLike): Promise<SwapReservation[]> {
  const local = (col: AnyPgColumn) => sql<string>`(${col} at time zone ${tz})::date::text`;
  const mins = (col: AnyPgColumn) => sql<number>`(extract(hour from (${col} at time zone ${tz})) * 60 + extract(minute from (${col} at time zone ${tz})))::int`;
  const rows = await q
    .select({
      id: reservations.id,
      code: reservations.code,
      productId: reservations.productId,
      resourceId: reservations.resourceId,
      partySize: reservations.partySize,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      exclusive: reservations.exclusive,
      bufferBeforeMin: reservations.bufferBeforeMin,
      bufferAfterMin: reservations.bufferAfterMin,
      startDate: local(reservations.startAt),
      endDate: local(reservations.endAt),
      startMin: mins(reservations.startAt),
      endMin: mins(reservations.endAt),
      customerName: users.name,
      selectMode: products.resourceSelectMode,
    })
    .from(reservations)
    .innerJoin(products, eq(products.id, reservations.productId))
    .leftJoin(users, eq(users.id, reservations.customerId))
    .where(and(eq(reservations.businessId, businessId), eq(reservations.resourceId, resourceId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), eq(local(reservations.startAt), date)))
    .orderBy(asc(reservations.startAt));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    productId: r.productId,
    resourceId: r.resourceId,
    partySize: r.partySize,
    startAt: r.startAt,
    endAt: r.endAt,
    exclusive: r.exclusive,
    bufferBeforeMin: r.bufferBeforeMin,
    bufferAfterMin: r.bufferAfterMin,
    startMin: r.startMin,
    // 자정을 넘긴 예약은 영업일 좌표로 이어 붙인다 (근무 구간도 같은 좌표계다)
    endMin: r.endDate === r.startDate ? r.endMin : r.endMin + 1440,
    customerName: r.customerName,
    directPick: r.selectMode === "REQUIRED",
  }));
}

/** 그날 그 자원의 근무 구간 — 승인된 예외만 본다 (대기 중인 휴가는 아직 근무표가 아니다) */
async function workOn(businessId: string, date: string, resourceId: string, extra: PlannedException[], q: DbLike): Promise<Interval[]> {
  const [b] = await q.select({ openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  const owner: SwapActor = { uid: "", role: "OWNER", memberId: "" };
  const [schedules, exceptions, hols] = await Promise.all([schedulesForRange(businessId, date, date, q), listExceptions(businessId, date, date, owner, q), holidaysForRange(businessId, date, date, q)]);
  const planned = extra.filter((e) => e.resourceId === resourceId && e.date === date).map((e) => ({ resourceId: e.resourceId, date: e.date, kind: e.kind, startTime: e.startTime, endTime: e.endTime }));
  return resolveWorkDay({ date, resourceId, openingHours: b.openingHours, schedules, exceptions: [...applicable(exceptions), ...planned], holidays: hols }).work;
}

/** 승인 트랜잭션이 만들 근무 예외 */
export type PlannedException = { resourceId: string; date: string; kind: "OFF" | "EXTRA"; startTime: string | null; endTime: string | null; reason: string };

export type SwapConflict = { reservationId: string; code: string; reason: "PRODUCT_RESOURCE" | "OUTSIDE_WORK" | "CAPACITY" };

export type SwapPlan = {
  exceptions: PlannedException[];
  /** 옮길 예약 — 승인 트랜잭션이 resourceId 를 바꾼다 */
  moves: Array<{ reservation: SwapReservation; toResourceId: string }>;
  conflicts: SwapConflict[];
  /** 고객이 담당자를 직접 지정한 예약 중 옮기는 것 */
  directPicks: SwapReservation[];
  /** 지금 시점의 대상 예약 id — 스냅샷 비교용 */
  currentIds: string[];
};

/**
 * 승인 0단계 — **트랜잭션 밖에서** 전부 판정한다 (FR-SHIFT-020).
 *
 * 근무표를 먼저 바꿔 놓고 예약 이관에서 실패하면 근무표만 어긋난 채 남는다. 그래서 여기서
 * 만들 예외·옮길 예약·막는 이유를 다 구해 놓고, 하나라도 막히면 상태를 건드리지 않는다.
 */
export async function planSwap(businessId: string, shape: SwapShape, tz: string, q: DbLike = db): Promise<SwapPlan> {
  const exceptions: PlannedException[] = [];
  const moves: SwapPlan["moves"] = [];
  const conflicts: SwapConflict[] = [];
  const directPicks: SwapReservation[] = [];
  const currentIds: string[] = [];
  const legs = swapLegs(shape);

  // 1) 각 방향의 근무를 읽고, 만들 예외를 정한다
  const legData: Array<{ leg: (typeof legs)[number]; list: SwapReservation[] }> = [];
  for (const leg of legs) {
    const work = await workOn(businessId, leg.date, leg.giverResourceId, [], q);
    if (work.length === 0) throw new HttpError(409, "NO_SHIFT_TO_SWAP", { date: leg.date, resourceId: leg.giverResourceId });
    // WorkException 은 `start < end` 인 하루 안의 구간만 담는다(DB CHECK). 자정까지(=1440)도 "00:00" 으로 적히면
    // 시작과 같아져 저장할 수 없다 — 넘겨줄 근무 시간을 적을 자리가 없으므로 여기서 막는다 (L-12 과 같이 푼다)
    if (work.some((w) => w.end >= 1440)) throw new HttpError(409, "SHIFT_CROSSES_MIDNIGHT", { date: leg.date });

    const list = await reservationsOnShift(businessId, leg.date, leg.giverResourceId, tz, q);
    currentIds.push(...list.map((r) => r.id));

    exceptions.push({ resourceId: leg.giverResourceId, date: leg.date, kind: "OFF", startTime: null, endTime: null, reason: "근무 교대" });
    // EXTRA 는 **대신 서는 쪽의 그 날짜**에 만든다 (넘기는 쪽의 날이 아니다 — 명세 3단계 주석)
    for (const w of work) exceptions.push({ resourceId: leg.takerResourceId, date: leg.date, kind: "EXTRA", startTime: fmtMin(w.start), endTime: fmtMin(w.end), reason: "근무 교대" });

    if (leg.reassign) {
      for (const r of list) {
        moves.push({ reservation: r, toResourceId: leg.takerResourceId });
        if (r.directPick) directPicks.push(r);
      }
    } else {
      // "유지" — 근무는 넘기되 그 예약 시간만 원 담당자가 나온다. OFF 위에 EXTRA 를 얹는 조합(resolve.ts 4·5순위)
      for (const r of list) {
        if (r.endMin >= 1440) {
          conflicts.push({ reservationId: r.id, code: r.code, reason: "OUTSIDE_WORK" });
          continue;
        }
        exceptions.push({ resourceId: leg.giverResourceId, date: leg.date, kind: "EXTRA", startTime: fmtMin(r.startMin), endTime: fmtMin(r.endMin), reason: "근무 교대 — 이 예약만 유지" });
      }
    }
    legData.push({ leg, list });
  }

  if (moves.length === 0) return { exceptions, moves, conflicts, directPicks, currentIds };

  // 2) 옮길 예약마다: 상품이 그 자원을 쓸 수 있는가
  const productIds = [...new Set(moves.map((m) => m.reservation.productId))];
  const links = await q.select({ productId: productResources.productId, resourceId: productResources.resourceId }).from(productResources).where(inArray(productResources.productId, productIds));
  const linked = new Set(links.map((l) => `${l.productId}:${l.resourceId}`));
  for (const m of moves) {
    if (!linked.has(`${m.reservation.productId}:${m.toResourceId}`)) conflicts.push({ reservationId: m.reservation.id, code: m.reservation.code, reason: "PRODUCT_RESOURCE" });
  }

  // 3) 옮긴 뒤 그 자원의 근무(만들 EXTRA 포함) 안에 완전히 들어가는가
  for (const m of moves) {
    const work = await workOn(businessId, dateOf(m.reservation, legData), m.toResourceId, exceptions, q);
    const inside = work.some((w) => w.start <= m.reservation.startMin && m.reservation.endMin <= w.end);
    if (!inside) conflicts.push({ reservationId: m.reservation.id, code: m.reservation.code, reason: "OUTSIDE_WORK" });
  }

  // 4) 옮긴 뒤 정원을 넘기지 않는가. **옮겨 오는 것들끼리도** 부딪힐 수 있으므로 최종 구성으로 센다
  //    (같은 날 맞교대면 서로의 예약을 통째로 바꿔 다는 것이라, 빠져나가는 건을 빼지 않으면 늘 정원 초과가 된다)
  const movedOut = new Set(moves.map((m) => m.reservation.id));
  const byTarget = new Map<string, Array<{ reservation: SwapReservation; date: string }>>();
  for (const m of moves) {
    const key = `${m.toResourceId}|${dateOf(m.reservation, legData)}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), { reservation: m.reservation, date: dateOf(m.reservation, legData) }]);
  }
  for (const [key, incoming] of byTarget) {
    const [resourceId, date] = key.split("|");
    const [res] = await q.select({ capacity: resources.capacity }).from(resources).where(eq(resources.id, resourceId)).limit(1);
    if (!res) throw new HttpError(404, "NOT_FOUND");
    const existing = (await reservationsOnShift(businessId, date, resourceId, tz, q)).filter((r) => !movedOut.has(r.id));
    const final = [...existing, ...incoming.map((i) => i.reservation)];
    for (const inc of incoming) {
      const others = final.filter((r) => r.id !== inc.reservation.id);
      if (inc.reservation.exclusive || res.capacity === 1) {
        if (others.some((o) => overlaps(o, inc.reservation))) conflicts.push({ reservationId: inc.reservation.id, code: inc.reservation.code, reason: "CAPACITY" });
        continue;
      }
      const peak = peakOccupancy(occupy(inc.reservation), others.map((o) => ({ occupyRange: occupy(o), partySize: o.partySize })));
      if (peak + inc.reservation.partySize > res.capacity) conflicts.push({ reservationId: inc.reservation.id, code: inc.reservation.code, reason: "CAPACITY" });
    }
  }

  return { exceptions, moves, conflicts: dedupe(conflicts), directPicks, currentIds };
}

const occupy = (r: SwapReservation) => ({ start: r.startAt.getTime() - r.bufferBeforeMin * 60_000, end: r.endAt.getTime() + r.bufferAfterMin * 60_000 });
const overlaps = (a: SwapReservation, b: SwapReservation) => occupy(a).start < occupy(b).end && occupy(b).start < occupy(a).end;
const dedupe = (list: SwapConflict[]) => [...new Map(list.map((c) => [`${c.reservationId}:${c.reason}`, c])).values()];

function dateOf(r: SwapReservation, legData: Array<{ leg: { date: string; giverResourceId: string }; list: SwapReservation[] }>): string {
  const hit = legData.find((d) => d.list.some((x) => x.id === r.id));
  if (!hit) throw new Error("예약이 어느 방향에서 왔는지 잃었다");
  return hit.leg.date;
}

/**
 * 교대 요청 (FR-SHIFT-010).
 *
 * **본인 자원에서만 낸다** — 사장님도 마찬가지다. 교대의 전제가 당사자 간 동의인데 사장님이 남의 이름으로
 * 요청을 내면 "수락" 이 동의가 아니게 되고, 애초에 사장님은 근무 예외로 근무표를 직접 고칠 수 있다.
 */
export async function createSwap(businessId: string, input: SwapInput, actor: SwapActor): Promise<{ id: string; reservationCount: number }> {
  return db.transaction(async (tx) => {
    const [biz] = await tx.select({ tz: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!biz) throw new HttpError(404, "NOT_FOUND");
    const mine = await myResource(businessId, actor.memberId, tx);
    if (!mine) throw new HttpError(403, "NO_OWN_RESOURCE");
    if (mine === input.targetResourceId) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["targetResourceId"], message: "자기 자신과는 교대할 수 없습니다" }] });

    const [target] = await tx
      .select({ id: resources.id, type: resources.type, isActive: resources.isActive, memberId: resources.memberId })
      .from(resources)
      .where(and(eq(resources.id, input.targetResourceId), eq(resources.businessId, businessId)))
      .limit(1);
    if (!target) throw new HttpError(404, "NOT_FOUND");
    // 계정이 붙어 있어야 수락할 사람이 있다. 공간·공용 자원은 근무표 자체가 없다
    if (target.type !== "STAFF" || !target.memberId) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["targetResourceId"], message: "계정이 연결된 담당자와만 교대할 수 있습니다" }] });
    if (!target.isActive) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["targetResourceId"], message: "쉬고 있는 담당자입니다" }] });
    const [member] = await tx.select({ status: businessMembers.status }).from(businessMembers).where(eq(businessMembers.id, target.memberId)).limit(1);
    if (member?.status !== "ACTIVE") throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["targetResourceId"], message: "쉬고 있는 담당자입니다" }] });

    const today = todayIn(biz.tz);
    for (const [path, date] of [["requestDate", input.requestDate], ["targetDate", input.targetDate ?? null]] as const) {
      if (date && date <= today) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: [path], message: "지난 날짜는 교대할 수 없습니다" }] });
    }

    const shape: SwapShape = {
      swapType: input.swapType,
      requesterResourceId: mine,
      targetResourceId: input.targetResourceId,
      requestDate: input.requestDate,
      targetDate: input.swapType === "EXCHANGE" ? (input.targetDate ?? null) : null,
      reassignRequester: input.reassignRequester,
      reassignTarget: input.swapType === "EXCHANGE" ? (input.reassignTarget ?? false) : null,
    };

    // 같은 두 사람·같은 날의 진행 중 요청이 둘이면 승인 순서에 따라 결과가 달라진다. 방향은 따지지 않는다 —
    // "가→나" 와 "나→가" 가 같은 날 함께 열려 있으면 둘 다 승인됐을 때 근무표가 제자리로 돌아온다
    const open = await tx
      .select({ a: shiftSwapRequests.requesterResourceId, b: shiftSwapRequests.targetResourceId })
      .from(shiftSwapRequests)
      .where(and(eq(shiftSwapRequests.businessId, businessId), eq(shiftSwapRequests.requestDate, input.requestDate), inArray(shiftSwapRequests.status, ["PENDING", "ACCEPTED"])));
    const pair = [mine, shape.targetResourceId].sort().join("|");
    if (open.some((o) => [o.a, o.b].sort().join("|") === pair)) throw new HttpError(409, "SWAP_EXISTS");

    // 요청 시점에 이미 막힌 것(넘길 근무가 없다 · GIVE 인데 대상이 그날 이미 근무 중)은 여기서 거른다.
    // 이관 가능 여부까지 여기서 확정하지는 않는다 — 승인까지 최대 72시간이 비므로 그건 승인 직전에 다시 본다
    const plan = await planSwap(businessId, shape, biz.tz, tx);
    if (input.swapType === "GIVE") {
      const targetWork = await workOn(businessId, input.requestDate, shape.targetResourceId, [], tx);
      if (targetWork.length > 0) throw new HttpError(409, "TARGET_ALREADY_WORKING", { date: input.requestDate });
    }

    const [row] = await tx
      .insert(shiftSwapRequests)
      .values({
        businessId,
        requesterResourceId: mine,
        targetResourceId: shape.targetResourceId,
        requestDate: shape.requestDate,
        swapType: shape.swapType,
        targetDate: shape.targetDate,
        reason: input.reason,
        reassignRequester: shape.reassignRequester,
        reassignTarget: shape.reassignTarget,
        // 요청 시점의 대상 예약 — 승인 직전 재조회와 다르면 그 사이 새 예약이 들어온 것이다 (FR-SHIFT-020)
        reservationIdsAtRequest: [...new Set(plan.currentIds)].sort(),
      })
      .returning({ id: shiftSwapRequests.id });
    return { id: row.id, reservationCount: plan.currentIds.length };
  });
}

export type SwapActionResult = { status: SwapStatus; movedReservationIds: string[] };

/**
 * 수락 · 거절 · 철회 · 승인 · 거부 (FR-SHIFT-020). 전이는 `swap-rules.ts` 표에 있는 것만.
 *
 * `APPROVED` 만 무거운 일을 한다: 스냅샷 재조회 → 0단계 사전 검증 → (전부 통과해야) 트랜잭션.
 * 자동 승인(`shiftAutoApprove`)이면 대상의 수락이 곧 승인이라, 한 번의 호출로 ACCEPTED 를 거쳐 APPROVED 까지 간다.
 */
export async function actOnSwap(businessId: string, id: string, input: SwapActionInput, actor: SwapActor, meta: RequestMeta): Promise<SwapActionResult> {
  const [biz] = await db.select({ tz: businesses.timezone, policy: businesses.policy }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new HttpError(404, "NOT_FOUND");
  const autoApprove = biz.policy.shiftAutoApprove === true;
  const mine = await myResource(businessId, actor.memberId);

  const [cur] = await db.select().from(shiftSwapRequests).where(and(eq(shiftSwapRequests.id, id), eq(shiftSwapRequests.businessId, businessId))).limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  const seats = seatsOf(cur, actor, mine);
  // 당사자도 사장님도 아니면 남의 교대다 — 존재를 알리지 않는다
  if (seats.length === 0) throw new HttpError(404, "NOT_FOUND");
  if (!allowed(cur, seats, autoApprove).includes(input.action)) {
    throw new HttpError(409, "INVALID_SWAP_ACTION", { status: cur.status, action: input.action });
  }

  // 수락은 그 자체로 끝나기도 하고(사장님 승인 대기), 자동 승인이면 그대로 반영까지 간다
  if (input.action === "ACCEPT") {
    const accepted = await setStatus(id, "PENDING", "ACCEPTED", { respondedAt: new Date() });
    if (!autoApprove) return { status: accepted, movedReservationIds: [] };
    return applyApproval(businessId, id, biz.tz, input, actor, meta);
  }
  if (input.action === "APPROVE") return applyApproval(businessId, id, biz.tz, input, actor, meta);

  const rule = SWAP_RULES[input.action];
  const status = await setStatus(id, cur.status, rule.to, input.action === "REJECT" ? { respondedAt: new Date() } : {});
  return { status, movedReservationIds: [] };
}

/** 조건부 갱신 — 그 사이 다른 쪽이 먼저 움직였으면 0행이고, 그건 실패다 */
async function setStatus(id: string, from: SwapStatus, to: SwapStatus, extra: Partial<typeof shiftSwapRequests.$inferInsert>, q: DbLike = db): Promise<SwapStatus> {
  const rows = await q
    .update(shiftSwapRequests)
    .set({ status: to, ...extra })
    .where(and(eq(shiftSwapRequests.id, id), eq(shiftSwapRequests.status, from)))
    .returning({ id: shiftSwapRequests.id });
  if (rows.length !== 1) throw new HttpError(409, "INVALID_SWAP_ACTION", { status: "CHANGED" });
  return to;
}

async function applyApproval(businessId: string, id: string, tz: string, input: SwapActionInput, actor: SwapActor, meta: RequestMeta): Promise<SwapActionResult> {
  const [cur] = await db.select().from(shiftSwapRequests).where(eq(shiftSwapRequests.id, id)).limit(1);
  if (!cur || cur.status !== "ACCEPTED") throw new HttpError(409, "INVALID_SWAP_ACTION", { status: cur?.status ?? "GONE" });
  const shape = shapeOf(cur);

  // ── 0단계 (예비). 트랜잭션 **밖**에서 먼저 본다 ─────────────────────────
  // 여기서 보는 이유는 "사람에게 물어봐야 하는 것" 을 자물쇠를 쥔 채 묻지 않기 위해서다 —
  // 담당자 직접 지정 확인(`SWAP_DIRECT_PICKS`)은 왕복이 한 번 더 필요하다.
  // **판정의 정본은 아래 트랜잭션 안의 재계산이다.** 여기 통과했다고 반영이 보장되지는 않는다.
  const preview = await planSwap(businessId, shape, tz);
  assertPlanUsable(preview, cur.reservationIdsAtRequest, input);

  const moved = await db.transaction(async (tx) => {
    // 1. 두 자원을 id 오름차순으로 잠근다 — 반대 방향 교대가 동시에 들어와도 데드락이 나지 않는다.
    //    예약 생성(`create.ts`)도 같은 키(`hashtext(resource_id::text)`)를 잡으므로, 이 뒤로는
    //    두 자원에 새 예약이 끼어들 수 없다
    for (const rid of [shape.requesterResourceId, shape.targetResourceId].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rid}))`);
    }

    // **자물쇠 안에서 다시 센다.** 바깥의 계산과 자물쇠 사이에 들어온 예약은 그 계산에 없다 —
    // 정원 N 자원이면 `peakOccupancy` 가 그만큼 낮게 나와 정원 초과 이관이 커밋될 수 있었다(리뷰 지적).
    // 스냅샷·충돌·직접 지정까지 같은 기준으로 다시 판정하고, 아래는 이 계획만 쓴다
    const plan = await planSwap(businessId, shape, tz, tx);
    assertPlanUsable(plan, cur.reservationIdsAtRequest, input);

    await setStatus(id, "ACCEPTED", "APPROVED", { approvedAt: new Date() }, tx);

    // 2~4. 근무표
    for (const e of plan.exceptions) {
      await tx.insert(workExceptions).values({ businessId, resourceId: e.resourceId, date: e.date, kind: e.kind, startTime: e.startTime, endTime: e.endTime, reason: e.reason, createdBy: actor.uid, status: "APPROVED" });
    }

    // 5. 예약 이관
    const ids: string[] = [];
    for (const m of plan.moves) {
      const rows = await tx
        .update(reservations)
        .set({ resourceId: m.toResourceId })
        .where(and(eq(reservations.id, m.reservation.id), eq(reservations.resourceId, m.reservation.resourceId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"])))
        .returning({ id: reservations.id, status: reservations.status });
      // 0단계 이후 그 예약이 취소·이동됐다 — 통째로 되돌린다. 근무표만 바뀐 상태를 만들지 않는다
      if (rows.length !== 1) throw new HttpError(409, "SWAP_RESERVATIONS_CHANGED", { reservations: [m.reservation.id] });
      await tx.insert(reservationLogs).values({
        reservationId: m.reservation.id,
        fromStatus: rows[0].status,
        toStatus: rows[0].status,
        fromResourceId: m.reservation.resourceId,
        toResourceId: m.toResourceId,
        actorId: actor.uid,
        reason: `근무 교대 ${id}`,
      });
      await writeAudit({ action: "RESERVATION_REASSIGN", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "RESERVATION", targetId: m.reservation.id, diff: { resourceId: { from: m.reservation.resourceId, to: m.toResourceId }, swapId: id }, meta }, tx);
      ids.push(m.reservation.id);
    }

    await writeAudit(
      {
        action: "SHIFT_APPROVE",
        actorId: actor.uid,
        actorRole: actor.role,
        businessId,
        targetType: "SHIFT_SWAP",
        targetId: id,
        diff: { swapType: shape.swapType, requestDate: shape.requestDate, targetDate: shape.targetDate, reassigned: ids.length, exceptions: plan.exceptions.length },
        meta,
      },
      tx,
    );
    return ids;
  });

  // 6. 담당자가 바뀐 예약의 고객에게 알린다. 커밋 뒤에, 실패해도 던지지 않는다 (#57 과 같은 규약)
  for (const rid of moved) await notifyReservation(rid, "REASSIGNED");
  return { status: "APPROVED", movedReservationIds: moved };
}

/**
 * 계획을 반영해도 되는가. **바깥(미리보기)과 자물쇠 안(정본)이 같은 판정을 쓰도록** 한 함수로 묶었다 —
 * 둘이 갈라지면 "미리보기는 통과했는데 반영에서 다른 이유로 막히는" 조합이 생긴다.
 */
function assertPlanUsable(plan: SwapPlan, atRequest: string[], input: SwapActionInput): void {
  if (snapshotKey(plan.currentIds) !== snapshotKey(atRequest)) {
    // 요청부터 승인까지 최대 72시간이 비어 있다 — 그 사이 들어온 예약을 못 보고 넘기면 안 된다
    throw new HttpError(409, "SWAP_RESERVATIONS_CHANGED", { reservations: plan.currentIds, atRequest });
  }
  if (plan.conflicts.length > 0) throw new HttpError(409, "SWAP_CONFLICT", { conflicts: plan.conflicts });
  if (plan.directPicks.length > 0 && !input.confirmDirectPicks) {
    // 담당자를 보고 예약한 고객이다 — 자동으로 바꾸지 않는다 (FR-SHIFT-030)
    throw new HttpError(409, "SWAP_DIRECT_PICKS", { reservations: plan.directPicks.map((r) => ({ id: r.id, code: r.code, customerName: r.customerName })) });
  }
}

/** C? 72시간 무응답 만료 (FR-SHIFT-010). 배치라 한 건이 막혀도 다음 건으로 넘어간다 */
export async function expireSwaps(now = new Date(), limit = 500): Promise<number> {
  const due = await db
    .select({ id: shiftSwapRequests.id })
    .from(shiftSwapRequests)
    .where(and(eq(shiftSwapRequests.status, "PENDING"), lt(shiftSwapRequests.createdAt, new Date(now.getTime() - SWAP_EXPIRE_HOURS * 3_600_000))))
    .orderBy(asc(shiftSwapRequests.createdAt))
    .limit(limit);
  let n = 0;
  for (const row of due) {
    try {
      await setStatus(row.id, "PENDING", "EXPIRED", {});
      n++;
    } catch (e) {
      // 그 사이 대상이 수락했거나 요청자가 철회한 건 — 조건부 UPDATE 가 0행을 낸다. 배치는 계속 돈다
      if (e instanceof HttpError && e.status === 409) continue;
      throw e;
    }
  }
  return n;
}
