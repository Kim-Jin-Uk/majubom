import { and, asc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { productResources, products, reservationLogs, reservations, resources, users } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { writeAudit } from "@/lib/audit";
import { isoDateSchema } from "@/lib/dates";
import type { RequestMeta } from "@/lib/request-meta";
import type { ReservationStatus } from "./slot-types";
import { formatInstant, localToInstant } from "./time";
import { ownResourceId } from "@/features/schedule/work-exceptions";
import { validateExisting } from "./transitions";

/**
 * 예약 콘솔의 읽기 계층 (FR-BOOK-080, #58). 목록·상세·담당자 변경.
 *
 * **범위는 사업장이 정한다.** 모든 질의가 `reservations.business_id = 내 사업장` 으로 시작하고,
 * 다른 사업장 예약 id 는 403 이 아니라 **404** 다 — 403 은 "그 id 는 있다" 를 알려 준다 (02 §1).
 * MANAGER 는 기본적으로 본인 담당 자원 건만 본다. `permissions.viewAllReservations` 가 있으면 전체.
 *
 * 고객 식별은 **이름 + 로그인 수단**이다 (명세) — `User.phone` 은 선택 입력이라 대부분 비어 있어 주 식별자로 쓸 수 없다.
 * 연락처는 그 예약을 가진 사업장 콘솔에서만 보인다(이 계층 밖으로 나가지 않는다).
 */

export type ConsoleActor = { uid: string; role: "OWNER" | "MANAGER"; memberId: string; businessId: string; canViewAll: boolean };

/** 콘솔 뷰어(JWT 스냅샷) → 이 계층이 쓰는 행위자. 라우트마다 권한 키 이름을 되풀이하지 않으려고 여기 둔다 */
export function consoleActor(v: { uid: string; membership: { role: "OWNER" | "MANAGER"; memberId: string; businessId: string; permissions: { viewAllReservations?: boolean } } }): ConsoleActor {
  return { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId, businessId: v.membership.businessId, canViewAll: Boolean(v.membership.permissions.viewAllReservations) };
}

const STATUSES = ["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELED_BY_USER", "CANCELED_BY_BIZ", "NO_SHOW", "REJECTED", "EXPIRED"] as const;

/** 커서는 우리가 만든 것만 받는다 — 모양을 안 보면 손으로 고친 값이 `new Date("abc")` 를 타고 500 이 된다 */
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/;

export const listQuerySchema = z.object({
  /** 영업일 기준 기간 (사업장 타임존). `to` 를 생략하면 하루치 — 7일 기본값은 목록 화면이 정한다 */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: z.array(z.enum(STATUSES)).optional(),
  resourceId: z.uuid().optional(),
  productId: z.uuid().optional(),
  createdVia: z.enum(["WEB", "CHAT", "WALK_IN"]).optional(),
  /** 고객명·이메일·예약코드·워크인 이름 */
  q: z.string().trim().max(100).optional(),
  /** 이전 페이지 마지막 항목의 `${startAt.toISOString()}|${id}` */
  cursor: z.string().regex(CURSOR_RE, "커서 형식이 올바르지 않습니다").optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListQuery = z.output<typeof listQuerySchema>;

export type ReservationRow = {
  id: string;
  code: string;
  status: ReservationStatus;
  /** 사업장 타임존의 벽시계 (`2026-10-01T10:00:00+09:00`) — 보는 사람의 시계가 어디에 있든 매장 시각으로 읽힌다 */
  startAt: string;
  endAt: string;
  partySize: number;
  createdVia: "WEB" | "CHAT" | "WALK_IN";
  productName: string;
  resourceId: string;
  resourceName: string;
  /** 워크인은 받아 적은 이름, 아니면 계정 이름 */
  customerName: string;
  /** 고객 식별 보조 — 로그인 수단. 워크인은 null */
  customerProvider: "LOCAL" | "KAKAO" | "GOOGLE" | null;
  /** 내 담당 건인가 (매니저 화면 강조용) */
  mine: boolean;
};

/** 존재할 수 없는 uuid — 담당 자원이 없는 매니저에게 빈 결과를 주려고 술어에 넣는다 */
const NO_RESOURCE = "00000000-0000-4000-8000-000000000000";

/**
 * 예약이 기간에 걸치려면 시작 시각이 아무리 일러도 이만큼 안이다 — 이용 시간 ≤ 480분(products CHECK) + 앞뒤 버퍼 각 ≤ 60분.
 * `end_at > lo` 만으로는 (resource_id, start_at)·(business_id, start_at) 인덱스를 못 태워 전체 스캔이 된다.
 */
const MAX_SPAN_MIN = 480 + 60 + 60;

/** ilike 패턴의 와일드카드를 글자로 되돌린다 — `%` 한 글자를 검색하면 전부 나오는 것을 막는다 */
const likeTerm = (raw: string) => `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * 기간에 **걸치는** 예약. 시작일만 보면 자정을 넘겨 끝나는 예약이 종료일 목록에서 사라진다 —
 * 20:00~02:00 영업에서 아침에 콘솔을 연 사장님이 지금 가게에 있는 손님의 예약을 못 찾는다.
 * 근무표(`calendar.ts`)·휴무 충돌(`holidays.ts`)이 이미 시작·종료 양쪽을 보므로 화면끼리 어긋나지 않게 여기도 같은 기준으로 둔다.
 * 정확히 lo 에 끝나는 예약은 그 날을 차지하지 않는다(`> lo`).
 */
const spansRange = (lo: Date, hi: Date) => and(gte(reservations.startAt, new Date(lo.getTime() - MAX_SPAN_MIN * 60_000)), lt(reservations.startAt, hi), sql`${reservations.endAt} > ${lo.toISOString()}::timestamptz`);

/**
 * 매니저가 볼 수 있는 범위. `scoped` 는 질의에 붙일 자원 제한(전체 권한이면 null),
 * `mineId` 는 "내 담당 건" 표시용 — 전체 권한이 있어도 내 자원은 알아야 강조할 수 있다.
 */
async function scope(actor: ConsoleActor): Promise<{ scoped: string | null; mineId: string | null }> {
  if (actor.role === "OWNER") return { scoped: null, mineId: null };
  const mineId = await ownResourceId(actor.businessId, actor.memberId);
  return { scoped: actor.canViewAll ? null : (mineId ?? NO_RESOURCE), mineId };
}

export async function listReservations(actor: ConsoleActor, q: ListQuery, tz: string, today: string): Promise<{ items: ReservationRow[]; nextCursor: string | null }> {
  const from = q.from ?? today;
  const to = q.to ?? from;
  if (to < from) throw new HttpError(400, "INVALID_RANGE");
  const limit = q.limit ?? 50;
  const { scoped, mineId } = await scope(actor);

  // 기간은 영업일 경계로 — 사업장 타임존의 from 00:00 부터 to+1 00:00 직전까지
  const lo = new Date(localToInstant(from, 0, tz));
  const hi = new Date(localToInstant(to, 1440, tz));
  // 스키마가 모양을 이미 봤다 — 여기서 다시 방어할 필요가 없다
  const cursor = q.cursor?.split("|");
  const cursorAt = cursor ? new Date(cursor[0]) : null;

  const rows = await db
    .select({
      id: reservations.id,
      code: reservations.code,
      status: reservations.status,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      partySize: reservations.partySize,
      createdVia: reservations.createdVia,
      guestLabel: reservations.guestLabel,
      productName: products.name,
      resourceId: reservations.resourceId,
      resourceName: resources.name,
      customerName: users.name,
      customerProvider: users.provider,
    })
    .from(reservations)
    .innerJoin(products, eq(products.id, reservations.productId))
    .innerJoin(resources, eq(resources.id, reservations.resourceId))
    .innerJoin(users, eq(users.id, reservations.customerId))
    .where(
      and(
        eq(reservations.businessId, actor.businessId),
        spansRange(lo, hi),
        scoped ? eq(reservations.resourceId, scoped) : undefined,
        q.status?.length ? inArray(reservations.status, q.status) : undefined,
        q.resourceId ? eq(reservations.resourceId, q.resourceId) : undefined,
        q.productId ? eq(reservations.productId, q.productId) : undefined,
        q.createdVia ? eq(reservations.createdVia, q.createdVia) : undefined,
        q.q ? or(ilike(users.name, likeTerm(q.q)), ilike(users.email, likeTerm(q.q)), ilike(reservations.code, likeTerm(q.q)), ilike(reservations.guestLabel, likeTerm(q.q))) : undefined,
        cursorAt ? or(sql`${reservations.startAt} > ${cursorAt.toISOString()}::timestamptz`, and(eq(reservations.startAt, cursorAt), sql`${reservations.id} > ${cursor![1]}`)) : undefined,
      ),
    )
    .orderBy(asc(reservations.startAt), asc(reservations.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      startAt: formatInstant(r.startAt.getTime(), tz),
      endAt: formatInstant(r.endAt.getTime(), tz),
      partySize: r.partySize,
      createdVia: r.createdVia,
      productName: r.productName,
      resourceId: r.resourceId,
      resourceName: r.resourceName,
      // 워크인은 계정이 아니라 받아 적은 이름이다
      customerName: r.guestLabel ?? r.customerName,
      customerProvider: r.createdVia === "WALK_IN" ? null : r.customerProvider,
      mine: r.resourceId === mineId,
    })),
    nextCursor: rows.length > limit ? `${page[page.length - 1].startAt.toISOString()}|${page[page.length - 1].id}` : null,
  };
}

export type ReservationDetail = ReservationRow & {
  productId: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerNote: string | null;
  internalMemo: string | null;
  cancelReason: string | null;
  canceledAt: string | null;
  noShowSource: "MANUAL" | "AUTO" | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  cancelDeadlineHours: number;
  createdAt: string;
  replacesReservationId: string | null;
  history: Array<{ at: string; from: ReservationStatus | null; to: ReservationStatus; actorName: string | null; reason: string | null }>;
};

export async function getReservation(actor: ConsoleActor, id: string, tz: string): Promise<ReservationDetail> {
  const { scoped, mineId } = await scope(actor);
  const [r] = await db
    .select({
      id: reservations.id,
      code: reservations.code,
      status: reservations.status,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      partySize: reservations.partySize,
      createdVia: reservations.createdVia,
      guestLabel: reservations.guestLabel,
      productId: reservations.productId,
      productName: products.name,
      resourceId: reservations.resourceId,
      resourceName: resources.name,
      customerName: users.name,
      customerProvider: users.provider,
      customerEmail: users.email,
      customerPhone: users.phone,
      customerNote: reservations.customerNote,
      internalMemo: reservations.internalMemo,
      cancelReason: reservations.cancelReason,
      canceledAt: reservations.canceledAt,
      noShowSource: reservations.noShowSource,
      durationMin: reservations.durationMin,
      bufferBeforeMin: reservations.bufferBeforeMin,
      bufferAfterMin: reservations.bufferAfterMin,
      cancelDeadlineHours: reservations.cancelDeadlineHours,
      createdAt: reservations.createdAt,
      replacesReservationId: reservations.replacesReservationId,
    })
    .from(reservations)
    .innerJoin(products, eq(products.id, reservations.productId))
    .innerJoin(resources, eq(resources.id, reservations.resourceId))
    .innerJoin(users, eq(users.id, reservations.customerId))
    .where(and(eq(reservations.id, id), eq(reservations.businessId, actor.businessId), scoped ? eq(reservations.resourceId, scoped) : undefined))
    .limit(1);
  // 다른 사업장 · 매니저 범위 밖은 똑같이 404 — 403 은 그 id 가 있다는 뜻이 된다
  if (!r) throw new HttpError(404, "NOT_FOUND");

  const logs = await db
    .select({ at: reservationLogs.createdAt, from: reservationLogs.fromStatus, to: reservationLogs.toStatus, reason: reservationLogs.reason, actorName: users.name })
    .from(reservationLogs)
    .leftJoin(users, eq(users.id, reservationLogs.actorId))
    .where(eq(reservationLogs.reservationId, id))
    .orderBy(asc(reservationLogs.createdAt));

  const walkIn = r.createdVia === "WALK_IN";
  return {
    ...r,
    startAt: formatInstant(r.startAt.getTime(), tz),
    endAt: formatInstant(r.endAt.getTime(), tz),
    createdAt: formatInstant(r.createdAt.getTime(), tz),
    canceledAt: r.canceledAt ? formatInstant(r.canceledAt.getTime(), tz) : null,
    customerName: r.guestLabel ?? r.customerName,
    customerProvider: walkIn ? null : r.customerProvider,
    // 워크인 내부 계정의 이메일(walkin+…@internal)은 사람 것이 아니다 — 보여 주지 않는다
    customerEmail: walkIn ? null : r.customerEmail,
    customerPhone: walkIn ? null : r.customerPhone,
    mine: r.resourceId === mineId,
    history: logs.map((l) => ({ ...l, at: formatInstant(l.at.getTime(), tz) })),
  };
}

/**
 * 담당자·공간 변경 (FR-BOOK-080 상세, 감사 `RESERVATION_REASSIGN`).
 * 상태는 그대로 두고 자원만 옮긴다 — 시간이 바뀌는 것은 예약 변경(FR-BOOK-050)이라 고객 몫이다.
 * 옮길 자원이 그 시각에 비어 있는지는 승인 재검증과 같은 함수(`validateExisting`)로 본다.
 */
export async function reassignReservation(actor: ConsoleActor, id: string, toResourceId: string, meta: RequestMeta): Promise<void> {
  if (actor.role !== "OWNER") throw new HttpError(403, "OWNER_ONLY");
  await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({
        id: reservations.id,
        businessId: reservations.businessId,
        productId: reservations.productId,
        resourceId: reservations.resourceId,
        status: reservations.status,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        partySize: reservations.partySize,
        exclusive: reservations.exclusive,
        bufferBeforeMin: reservations.bufferBeforeMin,
        bufferAfterMin: reservations.bufferAfterMin,
        cancelDeadlineHours: reservations.cancelDeadlineHours,
        productStatus: products.status,
      })
      .from(reservations)
      .innerJoin(products, eq(products.id, reservations.productId))
      .where(and(eq(reservations.id, id), eq(reservations.businessId, actor.businessId)))
      .limit(1);
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    if (cur.status !== "REQUESTED" && cur.status !== "CONFIRMED") throw new HttpError(409, "INVALID_TRANSITION", { status: cur.status });
    if (cur.resourceId === toResourceId) return;

    // 상품에 연결되지 않은 자원은 409 다(그 자원은 존재하고, 사장님도 그것을 안다 — 고칠 수 있는 상태의 문제).
    // 남의 사업장 자원은 404 — 존재를 알리지 않는다
    const [target] = await tx
      .select({ id: resources.id, capacity: resources.capacity, isActive: resources.isActive })
      .from(resources)
      .where(and(eq(resources.id, toResourceId), eq(resources.businessId, actor.businessId)))
      .limit(1);
    if (!target) throw new HttpError(404, "NOT_FOUND");
    // 비활성 자원은 기존 예약을 그대로 들고 있을 수는 있어도(FR-RES-010) 새로 배정받지는 않는다 —
    // `validateExisting` 은 이미 놓인 예약을 다시 보는 함수라 isActive 를 일부러 안 본다. 배정의 게이트는 여기다
    if (!target.isActive) throw new HttpError(409, "RESOURCE_INACTIVE");
    const [linked] = await tx.select({ productId: productResources.productId }).from(productResources).where(and(eq(productResources.productId, cur.productId), eq(productResources.resourceId, toResourceId))).limit(1);
    if (!linked) throw new HttpError(409, "RESOURCE_NOT_LINKED");

    // 자원 단위 직렬화 후 그 자리가 비어 있는지 — 생성·승인과 같은 잣대
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${toResourceId}))`);
    await validateExisting({ ...cur, resourceId: toResourceId, resourceCapacity: target.capacity, exclusive: target.capacity === 1 }, tx);

    const rows = await tx
      .update(reservations)
      .set({ resourceId: toResourceId, exclusive: target.capacity === 1 })
      .where(and(eq(reservations.id, id), eq(reservations.resourceId, cur.resourceId), eq(reservations.status, cur.status)))
      .returning({ id: reservations.id });
    if (rows.length !== 1) throw new HttpError(409, "CONFLICT");
    await tx.insert(reservationLogs).values({ reservationId: id, fromStatus: cur.status, toStatus: cur.status, fromResourceId: cur.resourceId, toResourceId, actorId: actor.uid, reason: "담당 변경" });
    await writeAudit(
      { action: "RESERVATION_REASSIGN", actorId: actor.uid, actorRole: actor.role, businessId: actor.businessId, targetType: "RESERVATION", targetId: id, diff: { resourceId: { from: cur.resourceId, to: toResourceId } }, meta },
      tx,
    );
  });
}

/** 대시보드·목록 헤더용 요약 — 오늘 예약 수, 승인 대기 수 */
export async function reservationCounts(actor: ConsoleActor, tz: string, today: string): Promise<{ today: number; pending: number }> {
  const { scoped } = await scope(actor);
  const lo = new Date(localToInstant(today, 0, tz));
  const hi = new Date(localToInstant(today, 1440, tz));
  // 두 수는 기간이 다르다 — 한 번의 스캔에 담으려고 바깥 WHERE 로 묶으면 승인 대기가 그 기간에 잘린다.
  // 만료 배치(C2)가 며칠 멈춰 있으면 지난 주의 진짜 미처리 건이 "대기 0" 으로 보이는데, 그걸 알아채라고 있는 숫자다
  const [todayRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.businessId, actor.businessId), scoped ? eq(reservations.resourceId, scoped) : undefined, inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), spansRange(lo, hi)));
  const [pendingRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.businessId, actor.businessId), scoped ? eq(reservations.resourceId, scoped) : undefined, eq(reservations.status, "REQUESTED")));
  return { today: todayRow?.n ?? 0, pending: pendingRow?.n ?? 0 };
}
