import type { ISODate, ISODateTime } from "./slot-types";

/**
 * 사업장 로컬 시각 ↔ 순간(epoch ms) 변환. 슬롯 계산이 쓰는 유일한 시간 변환기다.
 *
 * 규약(slot-types.ts "시간 규약"): 모든 `LocalTime` 은 **영업일 00:00 기준 분(minute)** 으로 다룬다.
 * 자정을 넘긴 구간은 1440 을 넘는 분으로 표현되고(예: 익일 01:00 = 1500), 여기서 날짜를 하루 넘겨 되돌린다.
 *
 * 변환은 **벽시계 기준**이다 — "영업일 00:00 에서 1500분 뒤" 가 아니라 "다음 날 01:00". 서머타임이 있는 타임존에서
 * 두 해석이 한 시간 어긋나는데, 사람이 근무표에 적은 것은 벽시계 쪽이다. `Intl` 이 오프셋의 정본이다(직접 표를 두지 않는다).
 */

const CACHE = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    CACHE.set(tz, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** 그 순간의 tz 벽시계 */
function wallAt(tz: string, ms: number): Wall {
  const p = dtf(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const h = get("hour");
  return { y: get("year"), mo: get("month"), d: get("day"), h: h === 24 ? 0 : h, mi: get("minute"), s: get("second") };
}

/** 그 순간의 UTC 오프셋(분). Asia/Seoul 이면 항상 540 */
function offsetMinutesAt(tz: string, ms: number): number {
  const w = wallAt(tz, ms);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60_000;
}

const pad = (n: number, len = 2) => String(Math.abs(n)).padStart(len, "0");

/**
 * 영업일 `date` 의 00:00 에서 `minutes` 분 뒤(벽시계)의 순간.
 * 1440 이상이면 그만큼 날짜를 넘긴다 — `localToInstant("2026-10-06", 1500, tz)` 는 10-07 01:00.
 */
export function localToInstant(date: ISODate, minutes: number, tz: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const dayShift = Math.floor(minutes / 1440);
  const m = ((minutes % 1440) + 1440) % 1440;
  const naive = Date.UTC(y, mo - 1, d + dayShift, Math.floor(m / 60), m % 60);

  // 전환 전후의 오프셋 두 개로 후보를 만든다 (하루 안에 두 번 바뀌는 타임존은 없다)
  const before = naive - offsetMinutesAt(tz, naive - 86_400_000) * 60_000;
  const after = naive - offsetMinutesAt(tz, naive + 86_400_000) * 60_000;
  if (before === after) return before;

  // 요청한 벽시계가 실제로 존재하는 후보만 남긴다
  const wanted = `${naive}`;
  const exists = (ms: number) => {
    const w = wallAt(tz, ms);
    return `${Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)}` === wanted;
  };
  const valid = [before, after].filter(exists);
  // 시계가 뒤로 간 날(같은 시각이 두 번) → 먼저 온 쪽. 앞으로 간 날(없는 시각) → 건너뛴 만큼 밀어서 뒤쪽
  return valid.length > 0 ? Math.min(...valid) : Math.max(before, after);
}

/** 오프셋을 가진 ISO 8601 — `2026-10-01T10:00:00+09:00` */
export function formatInstant(ms: number, tz: string): ISODateTime {
  const w = wallAt(tz, ms);
  const off = offsetMinutesAt(tz, ms);
  const sign = off < 0 ? "-" : "+";
  return `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** ISO 8601(오프셋 포함) → epoch ms. 파싱 실패는 던진다 — 계산 도중 NaN 이 번지는 것보다 낫다 */
export function toMs(t: ISODateTime): number {
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new TypeError(`해석할 수 없는 시각: ${t}`);
  return ms;
}
