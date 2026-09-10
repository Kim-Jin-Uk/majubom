"use client";

import { apiGet } from "@/lib/client-api";
import { addDays } from "@/features/schedule/resolve";
import type { WidgetProduct } from "./data";
import { ANY_RESOURCE, effectiveDuration, resourcePick, type Selection } from "./state";

/** 슬롯 API(`/api/public/products/:id/slots`) 의 응답. 필드는 `slot-types.ts` 의 투영 그대로 */
export type WidgetSlot = { start: string; end: string; resourceIds?: string[]; remaining: number };
export type WidgetExcluded = { start: string; end: string; resourceId: string; reason: "LEAD_TIME" | "FULL" | "OUT_OF_WINDOW"; remaining?: number };
export type SlotDay = { date: string; slots: WidgetSlot[]; excluded?: WidgetExcluded[] };

/** 슬롯 API 는 한 번에 31일까지 본다 (라우트의 MAX_DAYS) */
export const MAX_RANGE_DAYS = 31;

/**
 * 조회할 날짜 구간. **정책 밖은 애초에 묻지 않는다** — 서버가 빈 배열로 돌려주긴 하지만
 * 31일 상한이 있어서, 예약 가능일이 7일인 가게에 한 달을 물으면 쓸데없이 크다.
 */
export function windowFor(monthStart: string, bounds: { firstDate: string; lastDate: string }, daysInMonth: number): { from: string; to: string } | null {
  const monthEnd = addDays(monthStart, daysInMonth - 1);
  // 하한은 오늘이 아니라 **가장 이른 영업일**이다 — 자정을 넘겨 영업하는 가게는 어제가 아직 열려 있다 (A7)
  const from = monthStart < bounds.firstDate ? bounds.firstDate : monthStart;
  const to = monthEnd > bounds.lastDate ? bounds.lastDate : monthEnd;
  if (from > to) return null;
  // 상한은 31일이고 달은 최대 31일이라 잘릴 일이 없다. 그래도 계약이 바뀌면 조용히 틀리는 대신 여기서 자른다
  const capped = addDays(from, MAX_RANGE_DAYS - 1);
  return { from, to: to > capped ? capped : to };
}

/** 슬롯 조회 주소. 자원은 **1단계에서 고르는 상품(REQUIRED)** 일 때만 싣는다 — 4단계 자원을 실으면 다른 담당자의 시각이 사라진다 */
export function slotsUrl(p: WidgetProduct, sel: Selection, from: string, to: string): string {
  const q = new URLSearchParams({ date: from, to, partySize: String(sel.partySize) });
  const dur = effectiveDuration(p, sel);
  if (dur !== p.durationMin) q.set("durationMin", String(dur));
  if (resourcePick(p) === "step1" && sel.resourceId && sel.resourceId !== ANY_RESOURCE) q.set("resourceId", sel.resourceId);
  return `/api/public/products/${p.id}/slots?${q.toString()}`;
}

export async function fetchSlots(url: string, signal?: AbortSignal): Promise<{ days: SlotDay[] } | { error: string }> {
  const r = await apiGet<{ days: SlotDay[] }>(url, signal);
  return r.ok ? { days: r.data.days ?? [] } : { error: r.error };
}

/**
 * 달력 칸 하나의 상태. **순수 함수로 뽑아 둔 이유**: 이 판정의 하한(`firstDate`)이 백엔드의 날짜 범위
 * (`dateInRange`)와 어긋나면 "서버는 여는데 손님은 누를 수 없는 날" 이 생긴다 — 실제로 그랬다(A7).
 *
 * - `unknown` 아직 안 읽음. 비활성이되 "휴무" 로 칠하지 않는다 — 로딩과 마감은 다른 상태다
 * - `out` 예약 가능 기간 밖 · `closed` 그날 남은 자리가 없음 · `open` 고를 수 있음
 */
export type DayState = "open" | "closed" | "out" | "unknown";

export function dayState(date: string, bounds: { firstDate: string; lastDate: string }, days: SlotDay[] | null, byDate?: Map<string, SlotDay>): DayState {
  if (date < bounds.firstDate || date > bounds.lastDate) return "out";
  if (days === null) return "unknown";
  const d = byDate ? byDate.get(date) : days.find((x) => x.date === date);
  return (d?.slots.length ?? 0) > 0 ? "open" : "closed";
}
