import { addDays } from "@/features/schedule/resolve";
import { monthGrid, shiftMonth } from "./format";

/**
 * 달력 방향키 규칙 (#85 · APG Date Picker Dialog). **순수 함수** — 어느 날짜로 옮길지만 정한다.
 *
 * 달을 넘어가는 이동이 있어서(1일에서 ←, 마지막 주에서 ↓) "이번 달 안에서 자르기" 로는 안 된다.
 * 대신 **경계(`firstDate`~`lastDate`) 밖으로는 나가지 않는다** — 나가면 조회할 수 없는 날에 초점만 남는다.
 */
export type CalendarKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

const KEYS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
export const isCalendarKey = (k: string): k is CalendarKey => KEYS.includes(k);

/** 같은 날짜(일)를 다른 달에 옮길 때 — 3/31 에서 PageUp 이면 2월 말일로 맞춘다 */
function sameDayIn(monthStart: string, day: number): string {
  const { days } = monthGrid(monthStart);
  return days[Math.min(day, days.length) - 1];
}

export function nextFocus(from: string, key: CalendarKey, bounds: { firstDate: string; lastDate: string }): string {
  const day = Number(from.slice(8));
  const monthStart = `${from.slice(0, 7)}-01`;
  let to: string;
  switch (key) {
    case "ArrowLeft":
      to = addDays(from, -1);
      break;
    case "ArrowRight":
      to = addDays(from, 1);
      break;
    case "ArrowUp":
      to = addDays(from, -7);
      break;
    case "ArrowDown":
      to = addDays(from, 7);
      break;
    // 주의 처음·끝 (일요일 ~ 토요일). 달을 넘어갈 수 있다
    case "Home":
      to = addDays(from, -new Date(`${from}T00:00:00Z`).getUTCDay());
      break;
    case "End":
      to = addDays(from, 6 - new Date(`${from}T00:00:00Z`).getUTCDay());
      break;
    case "PageUp":
      to = sameDayIn(shiftMonth(monthStart, -1), day);
      break;
    case "PageDown":
      to = sameDayIn(shiftMonth(monthStart, 1), day);
      break;
  }
  // 경계 밖으로는 나가지 않는다 — 조회할 수 없는 날에 초점만 남으면 막다른 길이 된다
  if (to < bounds.firstDate) return from < bounds.firstDate ? from : bounds.firstDate;
  if (to > bounds.lastDate) return from > bounds.lastDate ? from : bounds.lastDate;
  return to;
}

/**
 * 격자에서 탭 한 번에 닿는 칸 하나 (roving tabindex). 고른 날짜 → 오늘 → 첫 예약 가능일 순서로 고르되,
 * **보고 있는 달 안에 있어야** 한다. 밖이면 그 달의 첫 예약 가능한 날.
 */
export function rovingDate(monthStart: string, sel: string | null, today: string, bounds: { firstDate: string; lastDate: string }): string {
  const { days } = monthGrid(monthStart);
  const inMonth = (d: string | null): d is string => Boolean(d) && d!.slice(0, 7) === monthStart.slice(0, 7);
  if (inMonth(sel)) return sel;
  if (inMonth(today) && today >= bounds.firstDate && today <= bounds.lastDate) return today;
  return days.find((d) => d >= bounds.firstDate && d <= bounds.lastDate) ?? days[0];
}
