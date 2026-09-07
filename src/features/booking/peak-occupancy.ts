/**
 * FR-BOOK-010 `peakOccupancy` — 겹침 합산이 아니라 순간 최대 동시 인원.
 *
 * ```
 * function peakOccupancy(resourceId, occupy):
 *   rs = reservations where resource_id = resourceId
 *                       and status in (REQUESTED, CONFIRMED)
 *                       and occupyRange && occupy
 *   # 점유 인원이 바뀌는 지점은 각 예약의 시작점뿐이다
 *   points = { occupy.start } ∪ { r.occupyRange.start | r ∈ rs, r.start ∈ occupy }
 *   return max over p ∈ points of Σ r.partySize where r.occupyRange ∋ p
 * ```
 *
 * 모든 구간은 반열림 `[start, end)`다. 10:00–11:00과 11:00–12:00은 겹치지 않는다.
 * 순수 함수 — DB·시계에 의존하지 않으며, 자원 필터·상태 필터는 호출자가 미리 하거나
 * `countsTowardOccupancy`로 한다.
 */

import type { ExistingReservation, ReservationStatus } from "./slot-types";

/** 시각 입력은 ISO 문자열(오프셋 포함), epoch ms, Date 중 아무것이나 */
export type Instant = string | number | Date;

export interface OccupyRange {
  start: Instant;
  end: Instant;
}

export interface OccupyingReservation {
  occupyRange: OccupyRange;
  partySize: number;
}

/** 점유로 치는 상태 (명세: REQUESTED, CONFIRMED) */
export const OCCUPYING_STATUSES: ReadonlySet<ReservationStatus> = new Set<ReservationStatus>([
  "REQUESTED",
  "CONFIRMED",
]);

export const countsTowardOccupancy = (
  r: Pick<ExistingReservation, "status">,
): boolean => OCCUPYING_STATUSES.has(r.status);

const toMs = (t: Instant): number => {
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  if (Number.isNaN(ms)) throw new TypeError(`peakOccupancy: 해석할 수 없는 시각 ${String(t)}`);
  return ms;
};

/**
 * `occupy` 구간 안에서 `reservations`의 순간 최대 동시 인원을 돌려준다.
 * 겹치는 예약이 없으면 0.
 *
 * @param occupy       새 예약의 점유 구간(버퍼 포함) `[start, end)`
 * @param reservations 같은 자원의 REQUESTED/CONFIRMED 예약 (버퍼 포함 occupyRange 스냅샷)
 */
export function peakOccupancy(
  occupy: OccupyRange,
  reservations: readonly OccupyingReservation[],
): number {
  const qs = toMs(occupy.start);
  const qe = toMs(occupy.end);
  if (!(qs < qe)) throw new RangeError("peakOccupancy: occupy.start < occupy.end 이어야 한다");

  // 1) occupyRange && occupy — 반열림 구간 교차
  const rs = reservations
    .map((r) => ({ s: toMs(r.occupyRange.start), e: toMs(r.occupyRange.end), n: r.partySize }))
    .filter((r) => r.s < qe && r.e > qs);
  if (rs.length === 0) return 0;

  // 2) 후보 지점: occupy.start + 구간 안에서 시작하는 예약들의 시작점
  const points = new Set<number>([qs]);
  for (const r of rs) if (r.s >= qs && r.s < qe) points.add(r.s);

  // 3) 각 지점에서 그 순간 진행 중인 예약의 인원 합, 그 최댓값
  let peak = 0;
  for (const p of points) {
    let sum = 0;
    for (const r of rs) if (r.s <= p && p < r.e) sum += r.n;
    if (sum > peak) peak = sum;
  }
  return peak;
}
