import { toMin } from "@/features/schedule/resolve";

/**
 * 영업일 규약: `close ≤ open` 이면 익일이고, 같으면 24시간이다 (slot-types 시간 규약).
 * 그대로 찍으면 심야 영업이 `20:00 – 02:00` 으로 거꾸로 읽히고, 24시간 영업은 `00:00 – 00:00` 이라 휴무로 읽힌다.
 */
export function hourText(h: { open: string; close: string; breaks?: { start: string; end: string }[] }): string {
  const breaks = h.breaks?.length ? ` (휴게 ${h.breaks.map((b) => `${b.start}–${b.end}`).join(", ")})` : "";
  if (h.open === h.close) return `24시간 영업${breaks}`;
  const overnight = toMin(h.close) <= toMin(h.open);
  return `${h.open} – ${overnight ? "익일 " : ""}${h.close}${breaks}`;
}

