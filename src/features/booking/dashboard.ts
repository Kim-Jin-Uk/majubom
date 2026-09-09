import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { reservations } from "@/db/schema";
import { openingWindows, operatingWindows } from "@/features/schedule/operating";
import { addDays, dateRange, dowOf, fmtMin, normalize, resolveWorkDay, type Interval } from "@/features/schedule/resolve";
import type { ISODate } from "./slot-types";
import { loadOperatingContext, type OperatingContext } from "./operating-context";
import { listReservations, MAX_SPAN_MIN, reservationCounts, scope, type ConsoleActor, type ReservationRow } from "./console";
import { localToInstant } from "./time";

/**
 * 콘솔 대시보드 (FR-BOOK-080, #59) — 오늘 예약 · 승인 대기 · 이번 주 가동률 · 이번 주 내 근무.
 *
 * **가동률은 슬롯 계산과 같은 운영시간을 쓴다** (`schedule/operating.ts`). 두 곳에 따로 구현하면
 * "가동률 60%" 인데 실제로는 팔 슬롯이 없는 상태가 되고, 그 어긋남은 아무도 눈치채지 못한다.
 *
 * 미응답 상담(명세의 네 번째 카드)은 `ChatRoom` 이 Firestore 에 있고 채팅 에픽이 아직이라 여기 없다.
 * `flags.chat` 이 켜지는 시점에 이 파일에 카드를 하나 더 붙인다.
 */

/** 운영 구간(분)을 순간(ms)으로. 자정을 넘긴 구간은 `localToInstant` 가 알아서 다음 날로 넘긴다 */
const toMsIntervals = (date: ISODate, wins: Interval[], tz: string) => wins.map((w) => ({ start: localToInstant(date, w.start, tz), end: localToInstant(date, w.end, tz) }));

const overlapMs = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export type ResourceUtilization = { resourceId: string; name: string; busyMin: number; openMin: number; rate: number | null; capacity: number };
export type Utilization = { busyMin: number; openMin: number; rate: number | null; byResource: ResourceUtilization[] };

/**
 * 가동률 = 판 **좌석-분** ÷ 가진 좌석-분.
 *
 * 재고를 시간이 아니라 좌석×시간으로 세는 이유: 정원 4인 방에 1인 예약 넷이 같은 시각에 들어오면
 * 방은 한 시간만 쓰였는데 예약 길이를 그냥 더하면 네 시간이 된다 — "운영 9시간 중 4시간 사용" 같은 거짓말이 나온다.
 * 판 좌석은 예약의 `exclusive` 스냅샷으로 센다(정원 1 = 팀 단위라 인원과 무관하게 1좌석 — 가정 A1).
 * 가진 좌석은 **지금** 정원이다: 분자는 "그때 판 것", 분모는 "지금 가진 것" 이라 정원을 줄이면 비율이 올라간다 —
 * 재고를 줄였으니 그게 맞다. 정원을 줄인 뒤 과거 구간이 100% 에 붙을 수 있어 `Math.min` 으로 막는다.
 *
 * 분자는 **운영시간 안으로 잘라서** 센다. 점유(버퍼 포함)가 개점 전·폐점 후로 나갈 수 있고,
 * 그대로 더하면 100% 를 넘는 값이 나오는데 그건 지표가 아니라 잡음이다. 다른 해석의 여지는 LATER.md L-33.
 */
export async function utilization(businessId: string, from: ISODate, to: ISODate, ctx: OperatingContext, scopedResourceId: string | null): Promise<Utilization> {
  const dates = dateRange(from, to);
  const pool = ctx.resources.filter((r) => !scopedResourceId || r.id === scopedResourceId);
  if (pool.length === 0 || dates.length === 0) return { busyMin: 0, openMin: 0, rate: null, byResource: [] };

  // 자원 × 날짜 운영 구간을 ms 로 펼쳐 둔다. 근무가 자정을 넘겨 다음 날 근무와 겹치면(22:00~06:00 + 05:00~13:00)
  // 그 한 시간이 두 번 세어지므로 병합한다.
  //
  // **분모와 분자가 보는 구간이 다르다** (LATER.md L-35): 분모는 브레이크를 뺀 "팔 수 있는 시간",
  // 분자는 브레이크를 포함한 구간으로 잰다. FIXED 상품은 브레이크에도 회차를 파는데(`fixedIgnoreBreaks`)
  // 콘솔은 사업장 단위라 그걸 모르므로, 브레이크로 자르면 실제로 판 회차가 통째로 사라진다.
  const sell = new Map<string, Array<{ start: number; end: number }>>();
  const span = new Map<string, Array<{ start: number; end: number }>>();
  for (const r of pool) {
    const wins = (breaks: boolean) =>
      normalize(dates.flatMap((d) => toMsIntervals(d, operatingWindows({ date: d, resource: r, opening: openingWindows(ctx.openingHours, d, breaks), openingHours: ctx.openingHours, schedules: ctx.schedules, exceptions: ctx.exceptions, holidays: ctx.holidays }), ctx.tz)));
    sell.set(r.id, wins(true));
    span.set(r.id, wins(false));
  }

  const lo = new Date(localToInstant(from, 0, ctx.tz));
  // `to` 의 영업일은 자정을 넘길 수 있다 — 상한을 24:00 으로 두면 심야 영업의 마지막 날 새벽 예약이
  // 분모(운영시간)에는 들어오는데 분자에는 없어서 가동률이 매주 낮게 나온다
  const hi = new Date(localToInstant(to, 2880, ctx.tz));
  const rows = await db
    .select({ resourceId: reservations.resourceId, startAt: reservations.startAt, endAt: reservations.endAt, partySize: reservations.partySize, exclusive: reservations.exclusive, before: reservations.bufferBeforeMin, after: reservations.bufferAfterMin })
    .from(reservations)
    .where(
      and(
        eq(reservations.businessId, businessId),
        inArray(reservations.resourceId, pool.map((r) => r.id)),
        // 취소·노쇼·거절은 재고를 쓰지 않았다. 대기(REQUESTED)도 아직 확정이 아니라 제외 — 명세 "확정·완료"
        inArray(reservations.status, ["CONFIRMED", "COMPLETED"]),
        gte(reservations.startAt, new Date(lo.getTime() - MAX_SPAN_MIN * 60_000)),
        lt(reservations.startAt, hi),
        sql`${reservations.endAt} > ${lo.toISOString()}::timestamptz`,
      ),
    );

  const busy = new Map<string, number>();
  for (const x of rows) {
    const occupy = { start: x.startAt.getTime() - x.before * 60_000, end: x.endAt.getTime() + x.after * 60_000 };
    let min = 0;
    for (const w of span.get(x.resourceId) ?? []) min += overlapMs(occupy, w);
    // 좌석 수는 예약이 들고 있는 **스냅샷**으로 정한다. `exclusive` 는 생성 시점의 `resourceCapacity === 1` 이라
    // (create.ts), 지금 정원으로 다시 판정하면 정원을 N→1 로 줄인 순간 과거 예약이 전부 1좌석으로 재집계된다 —
    // 지난주 가동률이 이번 주 설정 변경으로 바뀌는 지표는 비교할 수 없다
    const seats = x.exclusive ? 1 : x.partySize;
    busy.set(x.resourceId, (busy.get(x.resourceId) ?? 0) + (min / 60_000) * seats);
  }

  const byResource: ResourceUtilization[] = pool.map((r) => {
    const openMin = Math.round((sell.get(r.id) ?? []).reduce((n, w) => n + (w.end - w.start) / 60_000, 0)) * r.capacity;
    const busyMin = Math.round(busy.get(r.id) ?? 0);
    return { resourceId: r.id, name: r.name, capacity: r.capacity, busyMin, openMin, rate: openMin > 0 ? Math.min(1, busyMin / openMin) : null };
  });
  // 합계는 좌석-분끼리 더한다 — 자원별 비율의 평균이 아니라 재고 전체에 대한 비율이라야 "이번 주 얼마나 팔았나" 가 된다
  const openMin = byResource.reduce((n, r) => n + r.openMin, 0);
  const busyMin = byResource.reduce((n, r) => n + r.busyMin, 0);
  return { busyMin, openMin, rate: openMin > 0 ? Math.min(1, busyMin / openMin) : null, byResource };
}

export type MyDay = { date: ISODate; work: Array<{ start: string; end: string }>; minutes: number; off: boolean };

export type DashboardData = {
  today: ISODate;
  weekStart: ISODate;
  /** 오늘 걸치는 예약 건수 (미리보기 목록은 잘릴 수 있다) */
  todayCount: number;
  /** 승인 대기 링크가 열어 줄 기간의 끝 — 대기 건수는 기간을 안 보므로 목록 기본(7일)보다 넓혀 준다 */
  pendingTo: ISODate;
  todayItems: ReservationRow[];
  pending: number;
  thisWeek: Utilization;
  lastWeekRate: number | null;
  /** 담당 자원이 있는 사람만 (사장님도 본인 자원이 있으면 나온다) */
  myWeek: MyDay[] | null;
  myResourceName: string | null;
};

export async function getDashboard(actor: ConsoleActor, today: ISODate): Promise<DashboardData> {
  const weekStart = addDays(today, -dowOf(today));
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);

  const ctx = await loadOperatingContext(actor.businessId, prevStart, weekEnd);
  // 스코프·"내 자원" 판정은 목록·캘린더와 같은 함수로 (사장님도 본인이 STAFF 자원이면 "내 근무" 가 나온다)
  const { scoped, mineId } = await scope(actor);

  const [todayList, counts, thisWeek, prev] = await Promise.all([
    // 미리보기용 목록. 건수는 아래 counts 에서 온다 — 목록은 한 페이지(50건)에서 잘리므로 세는 데 쓰면 안 된다
    listReservations(actor, { from: today, to: today, status: ["REQUESTED", "CONFIRMED"] }, ctx.tz, today),
    reservationCounts(actor, ctx.tz, today),
    utilization(actor.businessId, weekStart, weekEnd, ctx, scoped),
    utilization(actor.businessId, prevStart, addDays(prevStart, 6), ctx, scoped),
  ]);

  const mineResource = mineId ? ctx.resources.find((r) => r.id === mineId) : undefined;
  const myWeek: MyDay[] | null = mineResource
    ? dateRange(weekStart, weekEnd).map((date) => {
        const day = resolveWorkDay({ date, resourceId: mineResource.id, openingHours: ctx.openingHours, schedules: ctx.schedules, exceptions: ctx.exceptions, holidays: ctx.holidays });
        const minutes = day.work.reduce((n, w) => n + (w.end - w.start), 0);
        return { date, work: day.work.map((w) => ({ start: fmtMin(w.start), end: fmtMin(w.end) })), minutes, off: minutes === 0 };
      })
    : null;

  return {
    today,
    weekStart,
    todayCount: counts.today,
    pendingTo: addDays(today, 90),
    todayItems: todayList.items,
    pending: counts.pending,
    thisWeek,
    lastWeekRate: prev.rate,
    myWeek,
    myResourceName: mineResource?.name ?? null,
  };
}
