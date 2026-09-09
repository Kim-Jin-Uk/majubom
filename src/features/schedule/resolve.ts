import type { Dow, Holiday, ISODate, OpeningHoursEntry, TimeRange, WorkException, WorkSchedule } from "@/features/booking/slot-types";

/**
 * 하루의 근무 구간 결정 (FR-SCH-020 우선순위). 순수 함수 — DB·시계 없음. 슬롯 엔진(FR-BOOK-010)도 이 함수를 쓴다.
 *
 * 우선순위 (높은 순):
 *   1 Holiday 사업장 전체 → 2 Holiday 자원별 → 3 Exception BLOCK → 4 EXTRA → 5 OFF → 6 MODIFIED → 7 WorkSchedule → 8 openingHours
 *
 * 구현은 "바탕 구간을 정한 뒤 위 순위가 깎아내리는" 순서로 한다:
 *   바탕 = MODIFIED 가 있으면 그 구간, OFF 가 있으면 빈 구간, 아니면 그날 유효한 WorkSchedule(휴게 제외)
 *   + EXTRA 구간을 더한다 (OFF 와 공존하면 근무 = EXTRA 만 — 교대 "유지" 가 만드는 조합)
 *   − BLOCK 구간, − 자원별 Holiday, − 사업장 Holiday
 * 예약 가능 구간(bookable) = 근무 ∩ 영업시간(휴게 제외). 영업시간이 없는 날은 빈 구간.
 *
 * 시각은 영업일 00:00 기준 분(minute). 끝 ≤ 시작이면 익일로 읽어 24h 를 더한다 (slot-types 시간 규약).
 */
export type Interval = { start: number; end: number };

export type DaySource = "HOLIDAY_BUSINESS" | "HOLIDAY_RESOURCE" | "OFF" | "MODIFIED" | "EXTRA" | "SCHEDULE" | "NONE";

export type ResolvedDay = {
  date: ISODate;
  /** 근무 구간 (휴게·BLOCK·휴무 차감 후) */
  work: Interval[];
  /** 예약 가능 = 근무 ∩ 영업시간(휴게 제외) */
  bookable: Interval[];
  /** 바탕이 어디서 왔나 — 화면 표시용 */
  source: DaySource;
  /** 그날 적용된 휴무 (사업장·자원) */
  holidays: Holiday[];
  /** 그날 적용된 예외 */
  exceptions: WorkException[];
  /** 영업하지 않는 날인가 (openingHours 에 요일 없음 또는 사업장 전일 휴무) */
  closed: boolean;
};

export function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function fmtMin(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/** [start, end) — end ≤ start 면 익일 */
export function span(start: string, end: string): Interval {
  const s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 1440;
  return { start: s, end: e };
}

export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  let out = base;
  for (const c of cut) {
    const next: Interval[] = [];
    for (const b of out) {
      if (c.end <= b.start || c.start >= b.end) {
        next.push(b);
        continue;
      }
      if (c.start > b.start) next.push({ start: b.start, end: c.start });
      if (c.end < b.end) next.push({ start: c.end, end: b.end });
    }
    out = next;
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start);
    const e = Math.min(x.end, y.end);
    if (s < e) out.push({ start: s, end: e });
  }
  return normalize(out);
}

export function normalize(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function totalMinutes(list: Interval[]): number {
  return list.reduce((n, i) => n + (i.end - i.start), 0);
}

// ── 날짜 유틸 (UTC 로 계산 — ISODate 문자열만 다루므로 타임존이 개입하지 않는다) ──
export function parseDate(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`);
}
export function fmtDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: ISODate, n: number): ISODate {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmtDate(x);
}
export function dowOf(d: ISODate): Dow {
  return parseDate(d).getUTCDay() as Dow;
}
export function lastDayOfMonth(d: ISODate): number {
  const x = parseDate(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
}

/** 이 휴무 규칙이 그 날짜에 적용되는가 (FR-SCH-010 유형별) */
export function holidayApplies(h: Holiday, date: ISODate): boolean {
  if (date < h.startDate) return false;
  if (h.type === "ONCE") return date <= (h.endDate ?? h.startDate);
  if (h.repeatUntil && date > h.repeatUntil) return false;
  const d = parseDate(date);
  switch (h.type) {
    case "WEEKLY":
      return d.getUTCDay() === h.dayOfWeek;
    case "MONTHLY_DAY":
      return h.isLastDayOfMonth ? d.getUTCDate() === lastDayOfMonth(date) : d.getUTCDate() === h.dayOfMonth;
    case "YEARLY": {
      // 월·일은 startDate 에서 — `month` 컬럼은 저장만 하고 판정엔 쓰지 않는다 (1/31 + month=2 처럼 없는 날짜가 생긴다). 2/29 는 윤년에만
      const s = parseDate(h.startDate);
      return d.getUTCMonth() === s.getUTCMonth() && d.getUTCDate() === s.getUTCDate();
    }
  }
}

/** 그 휴무가 하루에서 잘라내는 구간. 전일이면 이틀치(자정 넘긴 구간까지) */
export function holidayCut(h: Holiday): Interval[] {
  return h.isFullDay || !h.startTime || !h.endTime ? [{ start: 0, end: 2880 }] : [span(h.startTime, h.endTime)];
}

function scheduleFor(resourceId: string, date: ISODate, dow: Dow, schedules: WorkSchedule[]): WorkSchedule | null {
  return schedules.find((s) => s.resourceId === resourceId && s.dayOfWeek === dow && s.effectiveFrom <= date && (s.effectiveTo === null || date <= s.effectiveTo)) ?? null;
}

/** Business.openingHours(jsonb, dow: number) 도 그대로 받는다 */
export type OpeningLike = Omit<OpeningHoursEntry, "dow"> & { dow: number };

export type ResolveInput = {
  date: ISODate;
  resourceId: string;
  openingHours: OpeningLike[];
  schedules: WorkSchedule[];
  exceptions: WorkException[];
  holidays: Holiday[];
};

export function resolveWorkDay(input: ResolveInput): ResolvedDay {
  const { date, resourceId } = input;
  const dow = dowOf(date);
  const opening = input.openingHours.find((o) => o.dow === dow) ?? null;
  const exs = input.exceptions.filter((e) => e.resourceId === resourceId && e.date === date);
  const hols = input.holidays.filter((h) => (h.resourceId === null || h.resourceId === resourceId) && holidayApplies(h, date));
  const bizFullHoliday = hols.some((h) => h.resourceId === null && h.isFullDay);

  // 바탕
  let base: Interval[];
  let source: DaySource;
  const modified = exs.find((e) => e.kind === "MODIFIED");
  const off = exs.some((e) => e.kind === "OFF");
  // 5 OFF 가 6 MODIFIED 보다 위 — 둘이 같은 날이면 그날은 휴무다
  if (off) {
    base = [];
    source = "OFF";
  } else if (modified && modified.startTime && modified.endTime) {
    base = [span(modified.startTime, modified.endTime)];
    source = "MODIFIED";
  } else {
    const s = scheduleFor(resourceId, date, dow, input.schedules);
    base = s ? subtract([span(s.startTime, s.endTime)], (s.breaks ?? []).map((b: TimeRange) => span(b.start, b.end))) : [];
    source = s ? "SCHEDULE" : "NONE";
  }
  // + EXTRA (OFF 보다 위 — OFF+EXTRA 공존이면 근무 = EXTRA 만)
  const extras = exs.filter((e) => e.kind === "EXTRA" && e.startTime && e.endTime).map((e) => span(e.startTime!, e.endTime!));
  if (extras.length) {
    base = normalize([...base, ...extras]);
    if (source === "OFF" || source === "NONE") source = "EXTRA";
  }
  // − BLOCK
  const blocks = exs.filter((e) => e.kind === "BLOCK" && e.startTime && e.endTime).map((e) => span(e.startTime!, e.endTime!));
  let work = subtract(normalize(base), blocks);
  // − 휴무 (자원별 → 사업장, 어느 쪽이든 무조건 차단)
  for (const h of hols) work = subtract(work, holidayCut(h));
  if (bizFullHoliday) source = "HOLIDAY_BUSINESS";
  else if (hols.some((h) => h.resourceId === resourceId && h.isFullDay)) source = "HOLIDAY_RESOURCE";

  const openSpan = opening ? subtract([span(opening.open, opening.close)], (opening.breaks ?? []).map((b) => span(b.start, b.end))) : [];
  return {
    date,
    work,
    bookable: intersect(work, openSpan),
    source,
    holidays: hols,
    exceptions: exs,
    closed: !opening || bizFullHoliday,
  };
}

/** "2026-02-30" 같은 형식만 맞는 날짜를 거른다 — 그대로 두면 Invalid Date → 500 */
export function isValidISODate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const x = parseDate(d);
  return !Number.isNaN(x.getTime()) && fmtDate(x) === d;
}

/** 날짜 범위 [from, to] 의 ISODate 목록 (양끝 포함, 최대 62일) */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) out.push(d);
  return out;
}
