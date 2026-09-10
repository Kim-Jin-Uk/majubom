/**
 * 위젯의 표시 문구. 순수 — 사업장 타임존 기준으로만 읽는다.
 * 손님 기기의 시간대가 무엇이든 화면에 뜨는 것은 **가게 시각**이다 (해외에서 열어도 "10:00" 은 가게의 10시다).
 */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export const minsText = (n: number): string => (n % 60 === 0 ? `${n / 60}시간` : n > 60 ? `${Math.floor(n / 60)}시간 ${n % 60}분` : `${n}분`);

/** `2026-10-01` → `10월 1일 (목)`. UTC 로 만들어 요일만 읽는다 — 로컬 파싱은 기기 시간대에서 하루 밀린다 */
export function dayText(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

export const dowOfDate = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** ISO 순간 → 가게 벽시계 `HH:mm` */
export function clock(instant: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant));
}

/** `10:00 – 11:00`. 끝이 다음 날이면 `익일` 을 붙인다 (영업일 규약) */
export function rangeText(start: string, end: string, tz: string): string {
  const day = (i: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(i));
  return `${clock(start, tz)} – ${day(end) !== day(start) ? "익일 " : ""}${clock(end, tz)}`;
}

/** 달력 격자용 — 그 달 1일이 무슨 요일인지, 며칠까지인지 */
export function monthGrid(monthStart: string): { lead: number; days: string[] } {
  const [y, m] = monthStart.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return { lead, days: Array.from({ length: count }, (_, i) => `${monthStart.slice(0, 8)}${String(i + 1).padStart(2, "0")}`) };
}

/** `2026-10` 앞뒤 달의 1일 */
export function shiftMonth(monthStart: string, n: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`;
export const monthTitle = (monthStart: string): string => `${monthStart.slice(0, 4)}년 ${Number(monthStart.slice(5, 7))}월`;
export { DOW };
