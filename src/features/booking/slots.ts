import { addDays, dowOf, span, toMin, type Interval } from "@/features/schedule/resolve";
import { openingWindows, operatingWindows } from "@/features/schedule/operating";
import { countsTowardOccupancy, peakOccupancy } from "./peak-occupancy";
import type { ExcludedSlot, FixedExclusionReason, ISODate, Slot, SlotContext, SlotQuery, SlotResource, SlotResult } from "./slot-types";
import { todayIn } from "@/lib/dates";
import { formatInstant, localToInstant, toMs } from "./time";

/**
 * FR-BOOK-010 가용 슬롯 조회 — 순수 함수. 정본은 `majubom-docs/02_기능명세서.md` §3.7 의 의사코드,
 * 명세가 정하지 않은 지점의 해석은 `tests/fixtures/README.md` 의 가정 A1~A11 이고 40건이 그 기대값이다.
 *
 * 계산 순서(명세 그대로):
 *   0 입력 검증 · 날짜 범위 → 1 영업시간 → 2 STAFF 근무 교집합 → 3 휴무 차감 → 4 개인 차단 차감
 *   → 5 시작 시각 후보(FREE 격자 / FIXED 회차) → 6 최소 선행시간 → 7 잔여 정원 → mergeByStartTime
 *
 * 구간은 전부 **영업일 00:00 기준 분** 으로 다루고(자정 넘김은 1440 초과 분), 마지막에 한 번만 순간으로 바꾼다.
 * 1~4 단계의 STAFF 경로는 근무표 에픽의 `resolveWorkDay` 를 그대로 쓴다 — 우선순위 8단계를 구현한 곳은 거기 하나여야 한다.
 * 버퍼는 점유(occupy)에만 들어가고 구간 포함 판정에는 넣지 않는다: 명세 "버퍼는 운영 구간 밖으로 나갈 수 있다".
 */

/** 정원 1 은 한 팀이 슬롯을 통째로 쓴다 — 인원과 비교하지 않는다 (가정 A1) */
const isTeamUnit = (cap: number) => cap === 1;

/**
 * 그 자원이 그날 예약을 받을 수 있는 구간 (1~4단계). 구현은 `schedule/operating.ts` 하나다 —
 * 콘솔의 가동률·캘린더가 같은 함수를 쓰므로 "화면에 보이는 운영시간" 과 "실제로 팔리는 슬롯" 이 어긋나지 않는다.
 * 승인되지 않은 휴가 신청(PENDING)은 호출자(`context.ts`)가 걸러 넣는다.
 */
const resourceWindows = (ctx: SlotContext, date: ISODate, r: SlotResource, opening: Interval[]): Interval[] =>
  operatingWindows({ date, resource: r, opening, openingHours: ctx.business.openingHours, schedules: ctx.workSchedules, exceptions: ctx.workExceptions, holidays: ctx.holidays });

/**
 * FIXED 회차 시각 → 영업일 기준 분. 자정을 넘겨 영업하는 날의 이른 시각은 익일이다 (`{dow:2,"01:00"}` = 수요일 새벽 1시).
 * 익일로 미는 것은 **그렇게 밀면 그날 영업 구간 안에 들어올 때만** 이다 — 20:00~02:00 영업의 19:00 회차는 개장 전이지 익일 19:00 이 아니다.
 * 같은 요일 항목이 여러 개여도 전부 모으고, 같은 시각은 한 번만 센다(합산 잔여가 부풀지 않게).
 */
export function fixedStartMinutes(ctx: SlotContext, date: ISODate): number[] {
  const dow = dowOf(date);
  const times = (ctx.product.fixedStartTimes ?? []).filter((x) => x.dow === dow).flatMap((x) => x.times);
  if (times.length === 0) return [];
  const o = ctx.business.openingHours.find((x) => x.dow === dow);
  const dayEnd = o ? span(o.open, o.close).end : 1440;
  const openStart = o ? toMin(o.open) : 0;
  const shifted = times.map((t) => {
    const m = toMin(t);
    return m < openStart && m + 1440 < dayEnd ? m + 1440 : m;
  });
  return [...new Set(shifted)].sort((a, b) => a - b);
}

/** FREE 격자 — 로컬 00:00 을 기준으로 정렬한 격자에서 구간에 통째로 들어가는 시작점 (가정 A2) */
function freeCandidates(windows: Interval[], intervalMin: number, duration: number): number[] {
  const out: number[] = [];
  for (const w of windows) {
    let t = Math.ceil(w.start / intervalMin) * intervalMin;
    while (t + duration <= w.end) {
      out.push(t);
      t += intervalMin;
    }
  }
  return out.sort((a, b) => a - b);
}

const containedIn = (windows: Interval[], s: number, e: number) => windows.some((w) => w.start <= s && e <= w.end);

export function computeSlots(ctx: SlotContext, q: SlotQuery): SlotResult {
  const { business: biz, product: p } = ctx;
  const tz = biz.timezone;

  // 0) 입력 검증 — 실패는 throw 가 아니라 { error } (가정 A11). 조용히 기본값으로 바꾸지 않는다
  const options = p.durationOptions ?? null;
  if (options && options.length > 0 && q.durationMin !== undefined && !options.includes(q.durationMin)) return { error: "DURATION_NOT_ALLOWED" };
  // durationOptions 가 없는 상품은 query.durationMin 을 무시한다 (가정 A10)
  const duration = options && options.length > 0 ? (q.durationMin ?? p.durationMin) : p.durationMin;
  if (!Number.isInteger(duration) || duration <= 0) return { error: "DURATION_NOT_ALLOWED" };
  // 하한이 없으면 partySize 0 이 만석 슬롯을 "잔여 0 ≥ 0" 으로 통과시킨다. 예약 생성의 슬롯 재검증도 이 함수를 쓴다
  if (!Number.isInteger(q.partySize) || q.partySize < 1) return { error: "PARTY_SIZE_INVALID" };
  if (q.partySize > p.maxPartySize) return { error: "PARTY_SIZE_EXCEEDED" };
  if (p.resourceSelectMode === "REQUIRED" && !q.resourceId) return { error: "RESOURCE_REQUIRED" };
  if (q.resourceId && !p.resourceIds.includes(q.resourceId)) return { error: "RESOURCE_NOT_LINKED" };

  const isFixed = p.startMode === "FIXED";
  // 0) 날짜 범위 정책 — 범위 밖은 오류가 아니라 빈 결과. FIXED 는 응답 형태를 지키려고 빈 excluded 를 함께 준다
  const nowMs = toMs(ctx.now);
  const today = todayIn(tz, new Date(nowMs));
  if (q.date < today || q.date > addDays(today, biz.policy.maxAdvanceDays)) return isFixed ? { slots: [], excluded: [] } : { slots: [] };

  // FIXED 는 영업시간 브레이크를 차감하지 않는다(fixedIgnoreBreaks 기본 true). 근무표 휴게는 늘 차감된다 (가정 A4)
  const opening = openingWindows(ctx.business.openingHours, q.date, !(isFixed && (p.fixedIgnoreBreaks ?? true)));

  const resources = ctx.resources
    .filter((r) => p.resourceIds.includes(r.id) && r.isActive && (!q.resourceId || r.id === q.resourceId))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  // FREE 상품의 격자 간격은 DB CHECK(products_start_mode_shape)가 보장한다 — 없으면 데이터가 깨진 것이지 기본값을 끼워 넣을 자리가 아니다
  if (!isFixed && !p.slotIntervalMin) throw new TypeError(`FREE 상품 ${p.id} 에 slotIntervalMin 이 없다`);
  const fixedTimes = isFixed ? fixedStartMinutes(ctx, q.date) : [];

  const leadCutoff = nowMs + biz.policy.minLeadTimeMin * 60_000;
  const merged = new Map<number, { start: number; end: number; resourceIds: string[]; remaining: number }>();
  const excluded: Array<ExcludedSlot & { at: number }> = [];

  for (const r of resources) {
    const windows = resourceWindows(ctx, q.date, r, opening);
    const candidates = isFixed ? fixedTimes : freeCandidates(windows, p.slotIntervalMin!, duration);
    if (candidates.length === 0) continue;

    const cap = Math.min(p.capacityPerSlot, r.capacity);
    const needed = isTeamUnit(cap) ? 1 : q.partySize;
    // 후보마다 다시 파싱하지 않도록 여기서 한 번만 숫자로 (후보 × 예약 곱이라 파싱 비용이 그대로 곱해진다)
    const mine = ctx.existingReservations
      .filter((x) => x.resourceId === r.id && countsTowardOccupancy(x))
      .map((x) => ({ occupyRange: { start: Date.parse(x.occupyRange.start), end: Date.parse(x.occupyRange.end) }, partySize: x.partySize }));

    for (const t of candidates) {
      const startMs = localToInstant(q.date, t, tz);
      const endMs = localToInstant(q.date, t + duration, tz);
      const add = (reason: FixedExclusionReason, remaining?: number) => {
        // FIXED 만 제외 회차를 돌려준다 — FREE 는 후보 자체가 구간 안에서 만들어진다
        if (isFixed) excluded.push({ at: startMs, start: formatInstant(startMs, tz), end: formatInstant(endMs, tz), resourceId: r.id, reason, ...(remaining === undefined ? {} : { remaining }) });
      };

      // 판정 순서는 OUT_OF_WINDOW → LEAD_TIME → FULL (가정 A9)
      if (isFixed && !containedIn(windows, t, t + duration)) {
        add("OUT_OF_WINDOW");
        continue;
      }
      if (startMs < leadCutoff) {
        add("LEAD_TIME");
        continue;
      }

      // 7) 잔여 = 정원 − 그 구간의 순간 최대 동시 인원. 점유 구간에만 버퍼가 들어간다
      const occupy = { start: startMs - p.bufferBeforeMin * 60_000, end: endMs + p.bufferAfterMin * 60_000 };
      const peak = peakOccupancy(occupy, mine);
      const remaining = isTeamUnit(cap) ? (peak > 0 ? 0 : 1) : Math.max(0, cap - peak);
      if (remaining < needed) {
        add("FULL", remaining);
        continue;
      }

      // mergeByStartTime — 자원 무관 조회에서 같은 시각을 하나로 합산 (자원 순서는 sortOrder)
      const hit = merged.get(startMs);
      if (hit) {
        hit.resourceIds.push(r.id);
        hit.remaining += remaining;
      } else {
        merged.set(startMs, { start: startMs, end: endMs, resourceIds: [r.id], remaining });
      }
    }
  }

  const slots: Slot[] = [...merged.values()]
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ start: formatInstant(s.start, tz), end: formatInstant(s.end, tz), resourceIds: s.resourceIds, remaining: s.remaining }));

  if (!isFixed) return { slots };
  return {
    slots,
    excluded: excluded.sort((a, b) => a.at - b.at).map((e) => ({ start: e.start, end: e.end, resourceId: e.resourceId, reason: e.reason, ...(e.remaining === undefined ? {} : { remaining: e.remaining }) })),
  };
}
