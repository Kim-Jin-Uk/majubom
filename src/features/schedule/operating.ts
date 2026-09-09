import type { Holiday, ISODate, OpeningHoursEntry, ResourceType, WorkException, WorkSchedule } from "@/features/booking/slot-types";
import { dowOf, holidayApplies, holidayCut, intersect, resolveWorkDay, span, subtract, type Interval } from "./resolve";

/**
 * "이 자원이 그날 예약을 받을 수 있는 구간" — 슬롯 계산(FR-BOOK-010)과 콘솔 지표(FR-BOOK-080 가동률·캘린더)가
 * 같은 답을 내야 하는 계산이다. 두 곳에 따로 쓰면 화면의 가동률과 실제로 팔리는 슬롯이 어긋난다.
 *
 * STAFF 는 근무표의 8단계 우선순위를 그대로 탄다(`resolveWorkDay` 하나가 그 구현이다).
 * 공간·공용 자원은 근무표가 없으므로 영업시간에서 휴무와 개인 차단만 뺀다.
 */
export type OperatingInput = {
  date: ISODate;
  resource: { id: string; type: ResourceType };
  /** 그날 영업 구간. FIXED 상품은 브레이크를 빼지 않은 것을 넘긴다 (tests/fixtures/README.md 가정 A4) */
  opening: Interval[];
  openingHours: Array<Omit<OpeningHoursEntry, "dow"> & { dow: number }>;
  schedules: WorkSchedule[];
  /** **APPROVED 만** — 승인 대기 중인 휴가는 아직 근무표가 아니라서 예약을 계속 받아야 한다 */
  exceptions: WorkException[];
  holidays: Holiday[];
};

export function operatingWindows(i: OperatingInput): Interval[] {
  if (i.resource.type === "STAFF") {
    // day.bookable 을 쓰지 않는 이유: 그건 늘 영업시간 브레이크를 빼는데, FIXED 상품은 그 브레이크를 차감하지 않는다 (가정 A4)
    const day = resolveWorkDay({ date: i.date, resourceId: i.resource.id, openingHours: i.openingHours, schedules: i.schedules, exceptions: i.exceptions, holidays: i.holidays });
    return intersect(i.opening, day.work);
  }
  let w = i.opening;
  for (const h of i.holidays) if ((h.resourceId === null || h.resourceId === i.resource.id) && holidayApplies(h, i.date)) w = subtract(w, holidayCut(h));
  for (const e of i.exceptions) if (e.resourceId === i.resource.id && e.date === i.date && e.kind === "BLOCK" && e.startTime && e.endTime) w = subtract(w, [span(e.startTime, e.endTime)]);
  return w;
}

/** 그날 영업 구간. `subtractBreaks=false` 는 FIXED 상품 전용 */
export function openingWindows(openingHours: OperatingInput["openingHours"], date: ISODate, subtractBreaks: boolean): Interval[] {
  const o = openingHours.find((x) => x.dow === dowOf(date));
  if (!o) return [];
  const base = [span(o.open, o.close)];
  return subtractBreaks ? subtract(base, (o.breaks ?? []).map((b) => span(b.start, b.end))) : base;
}
