import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { products, reservations, users } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { openingWindows, operatingWindows } from "@/features/schedule/operating";
import { addDays, dateRange, type Interval } from "@/features/schedule/resolve";
import type { ISODate, ReservationStatus } from "./slot-types";
import { loadOperatingContext } from "./operating-context";
import { scope, type ConsoleActor } from "./console";
import { localToInstant } from "./time";

/**
 * 예약 캘린더 (FR-BOOK-080, #60 의 "일/주 캘린더 뷰").
 *
 * 화면은 계산하지 않는다 — 자원별 컬럼과 시간 격자에 그대로 얹을 수 있는 모양으로 내려준다.
 * 시각은 **영업일 00:00 기준 분**이라 자정을 넘긴 예약은 `endMin > 1440` 으로 나온다(시작 날짜 컬럼에 그대로 이어 그린다).
 * 운영시간 밖은 회색으로 죽여야 하므로 예약뿐 아니라 `open` 구간도 함께 준다 — 슬롯 계산과 같은 `operatingWindows` 다.
 */

/** 취소·거절·만료는 격자에 그리지 않는다 — 재고를 쓰지 않았고, 색만 늘리면 오늘 할 일이 안 보인다 */
const SHOWN: ReservationStatus[] = ["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW"];

export type CalendarBlock = {
  id: string;
  code: string;
  status: ReservationStatus;
  /** 그 컬럼(시작 날짜) 00:00 기준 분. 자정을 넘기면 endMin > 1440 */
  startMin: number;
  endMin: number;
  partySize: number;
  customerName: string;
  productName: string;
  mine: boolean;
};

export type CalendarDay = { date: ISODate; open: Interval[]; blocks: CalendarBlock[] };
export type CalendarColumn = { resourceId: string; name: string; /** 비활성 자원 — 남은 예약 때문에만 떠 있는 컬럼 */ inactive: boolean; days: CalendarDay[] };
export type CalendarData = {
  from: ISODate;
  to: ISODate;
  dates: ISODate[];
  /** 격자에 실제로 그릴 시간 범위 (분). 운영시간과 예약을 다 담되 빈 새벽은 접는다 */
  gridStartMin: number;
  gridEndMin: number;
  columns: CalendarColumn[];
};

export async function getCalendar(actor: ConsoleActor, from: ISODate, to: ISODate): Promise<CalendarData> {
  const dates = dateRange(from, to);
  if (dates.length === 0 || dates.length > 31) throw new HttpError(400, "INVALID_RANGE");
  // 스코프는 목록·상세와 **같은 함수**로 정한다 — 호출자가 넘기게 두면 언젠가 null 을 넘기는 자리가 생긴다
  const { scoped, mineId } = await scope(actor);
  // 전날 것도 계산해야 한다 — 자정을 넘겨 영업하는 날은 **다음 달력 날짜의 새벽까지** 자기 영업일이라,
  // 그 전날을 안 보면 어느 컬럼 임자인지 판정할 수 없다
  const ctx = await loadOperatingContext(actor.businessId, addDays(from, -1), to);
  const visible = ctx.resources.filter((r) => !scoped || r.id === scoped);

  const lo = new Date(localToInstant(from, 0, ctx.tz));
  // 영업일은 자정을 넘길 수 있다 — `to` 의 영업일은 최대 다음 날 23:59 까지 간다(`span()` 이 익일에 1440 을 더한다).
  // 상한을 `to` 24:00 으로 두면 20:00~02:00 영업의 마지막 날 새벽 예약이 통째로 빠진다
  const hi = new Date(localToInstant(to, 2880, ctx.tz));
  const rows = visible.length
    ? await db
        .select({
          id: reservations.id,
          code: reservations.code,
          status: reservations.status,
          startAt: reservations.startAt,
          endAt: reservations.endAt,
          partySize: reservations.partySize,
          resourceId: reservations.resourceId,
          guestLabel: reservations.guestLabel,
          createdVia: reservations.createdVia,
          productName: products.name,
          customerName: users.name,
        })
        .from(reservations)
        .innerJoin(products, eq(products.id, reservations.productId))
        .innerJoin(users, eq(users.id, reservations.customerId))
        .where(
          and(
            eq(reservations.businessId, actor.businessId),
            inArray(reservations.resourceId, visible.map((r) => r.id)),
            inArray(reservations.status, SHOWN),
            // 시작 시각으로만 뽑는다 — 어느 컬럼의 것인지는 아래에서 **영업일**로 정한다.
            // (기간 이전에 시작한 예약은 그 영업일이 이 범위 밖이므로 여기 없는 게 맞다)
            gte(reservations.startAt, lo),
            lt(reservations.startAt, hi),
          ),
        )
        .orderBy(asc(reservations.startAt))
    : [];

  // 비활성 자원은 컬럼을 만들지 않는다 — 단, **남은 예약이 있으면 만든다**.
  // 미래 예약을 가진 채로 비활성화하는 것이 정상 플로우라(`business/resources.ts` removeResource),
  // 여기서 빼 버리면 그 예약이 캘린더에서 통째로 사라지는데 목록에는 그대로 보여 두 화면이 어긋난다.
  const withRows = new Set(rows.map((x) => x.resourceId));
  const pool = visible.filter((r) => r.isActive || withRows.has(r.id));

  /** 그 자원의 그날 운영 구간 (분). 전날도 필요하다 — 아래 `ownsBlock` 참고 */
  const winOf = (r: (typeof pool)[number], date: ISODate) =>
    // 비활성 자원은 팔 수 있는 시간이 없다 — 컬럼 전체가 닫힌 색이라 "남은 예약만 처리하는 자리" 로 읽힌다
    r.isActive ? operatingWindows({ date, resource: r, opening: openingWindows(ctx.openingHours, date, true), openingHours: ctx.openingHours, schedules: ctx.schedules, exceptions: ctx.exceptions, holidays: ctx.holidays }) : [];
  /** 그 영업일이 덮는 끝 시각 (분). 자정을 넘기면 1440 초과 */
  const endOf = (r: (typeof pool)[number], date: ISODate) => Math.max(1440, ...winOf(r, date).map((w) => w.end));

  let gridStart = 24 * 60;
  let gridEnd = 0;
  const columns: CalendarColumn[] = pool.map((r) => {
    const days: CalendarDay[] = dates.map((date) => {
      const open = winOf(r, date);
      for (const w of open) {
        gridStart = Math.min(gridStart, w.start);
        gridEnd = Math.max(gridEnd, w.end);
      }
      const dayZero = localToInstant(date, 0, ctx.tz);
      const prev = addDays(date, -1);
      const prevZero = localToInstant(prev, 0, ctx.tz);
      // 이 컬럼이 덮는 범위 = 00:00 부터 그날 영업이 끝나는 시각까지(자정을 넘기면 1440 초과).
      // 심야 영업(20:00~02:00)의 01:00 예약은 **달력상 다음 날**이지만 영업일은 전날이다.
      // 달력 날짜로만 가르면 그 예약이 이 컬럼의 닫힌 구간에 유령처럼 뜨고, 전날 컬럼에도 떠서 같은 예약이 두 번 보인다.
      // `dates` 안에서만 중복을 막으면 기간의 첫날(전날이 범위 밖)에서 그대로 새어 나온다 — 그래서 전날 구간을 직접 본다.
      const dayEnd = Math.max(1440, ...open.map((w) => w.end));
      const prevEnd = endOf(r, prev);
      const blocks: CalendarBlock[] = rows
        .filter((x) => x.resourceId === r.id)
        .map((x) => ({ x, startMin: Math.round((x.startAt.getTime() - dayZero) / 60_000), endMin: Math.round((x.endAt.getTime() - dayZero) / 60_000), prevMin: Math.round((x.startAt.getTime() - prevZero) / 60_000) }))
        .filter((p) => p.startMin >= 0 && p.startMin < dayEnd && !(p.prevMin >= 0 && p.prevMin < prevEnd))
        .map(({ x, startMin, endMin }) => {
          gridStart = Math.min(gridStart, startMin);
          gridEnd = Math.max(gridEnd, endMin);
          return {
            id: x.id,
            code: x.code,
            status: x.status,
            startMin,
            endMin,
            partySize: x.partySize,
            // 워크인은 계정이 아니라 받아 적은 이름 (목록·상세와 같은 규칙)
            customerName: x.guestLabel ?? x.customerName,
            productName: x.productName,
            mine: x.resourceId === mineId,
          };
        });
      return { date, open, blocks };
    });
    return { resourceId: r.id, name: r.name, inactive: !r.isActive, days };
  });

  // 아무것도 없는 주(전부 휴무)면 기본 창을 준다 — 높이 0 짜리 격자를 그리지 않게
  if (gridEnd <= gridStart) {
    gridStart = 9 * 60;
    gridEnd = 21 * 60;
  }
  return { from, to, dates, gridStartMin: Math.floor(gridStart / 60) * 60, gridEndMin: Math.ceil(gridEnd / 60) * 60, columns };
}
