/**
 * FR-BOOK-010 가용 슬롯 조회 — 순수 함수 입력/출력 타입.
 *
 * 정본: reservation-docs/02_기능명세서.md §3.7 FR-BOOK-010, §2.2 엔티티.
 * 필드명은 명세의 엔티티 정의를 그대로 따른다. DB 행이 아니라 "계산에 필요한 값만" 담은
 * 투영(projection)이므로 id·FK 등 계산에 쓰이지 않는 컬럼은 생략했다.
 *
 * 시간 규약(명세 "시간 규약" 소절):
 * - `LocalTime`은 영업일(query.date) 기준 사업장 로컬 시각이다.
 * - `close ≤ open`, `endTime ≤ startTime`이면 끝 시각은 익일이다 (openingHours · WorkSchedule ·
 *   Holiday 부분구간 · WorkException 모두).
 * - `fixedStartTimes[].dow`는 영업일의 요일이다. 화요일 20:00~02:00 영업의 `{dow:2, times:["01:00"]}`은
 *   수요일 새벽 1시다.
 * - 출력 시각은 항상 오프셋을 가진 ISO 8601 (`2026-10-01T10:00:00+09:00`).
 */

/** `YYYY-MM-DD` */
export type ISODate = string;
/** `HH:mm` (24시간, 사업장 로컬) */
export type LocalTime = string;
/** ISO 8601 with offset — `2026-10-01T10:00:00+09:00` */
export type ISODateTime = string;

/** 0(일) ~ 6(토) */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 휴게 구간. `Business.openingHours.breaks`와 `WorkSchedule.breaks`가 같은 형식 */
export interface TimeRange {
  start: LocalTime;
  end: LocalTime;
}

// ───────────────────────────── Business ─────────────────────────────

/** `Business.openingHours` 요소. 목록에 없는 요일은 휴무(영업 안 함) */
export interface OpeningHoursEntry {
  dow: Dow;
  open: LocalTime;
  /** `close ≤ open`이면 익일 */
  close: LocalTime;
  /** 최대 2구간 (FR-BIZ-010) */
  breaks?: TimeRange[];
}

/** `Business.policy` 중 슬롯 계산에 쓰이는 키 (FR-BIZ-020) */
export interface SlotPolicy {
  /** 지금부터 N분 이후 슬롯만 노출. 기본 60 */
  minLeadTimeMin: number;
  /** 오늘부터 N일 이내만 (양끝 포함). 기본 30 */
  maxAdvanceDays: number;
}

export interface SlotBusiness {
  /** IANA. 기본 `Asia/Seoul` */
  timezone: string;
  openingHours: OpeningHoursEntry[];
  policy: SlotPolicy;
}

// ───────────────────────────── Product ─────────────────────────────

export type StartMode = "FREE" | "FIXED";
export type ResourceSelectMode = "REQUIRED" | "OPTIONAL" | "AUTO" | "NONE";
/** FR-PRD-010: 10/15/20/30/60분 중 선택 */
export type SlotIntervalMin = 10 | 15 | 20 | 30 | 60;

/** `Product.fixedStartTimes` 요소. `dow`는 영업일의 요일 */
export interface FixedStartTimesEntry {
  dow: Dow;
  times: LocalTime[];
}

/** 3스위치(시작 시각 · 이용 시간 · 정원) + 버퍼 + 자원 연결 */
export interface SlotProduct {
  id: string;
  /** 시작 시각 스위치 */
  startMode: StartMode;
  /** FIXED일 때 필수, FREE면 null */
  fixedStartTimes: FixedStartTimesEntry[] | null;
  /** FIXED 상품이 영업시간 브레이크를 차감하지 않는지. 기본 true (FR-PRD-010) */
  fixedIgnoreBreaks?: boolean;
  /** FREE일 때 필수, FIXED면 null(무시) */
  slotIntervalMin: SlotIntervalMin | null;
  /** 이용 시간 스위치 — 기본 소요 시간(분). `durationOptions`가 있으면 그중 기본값 */
  durationMin: number;
  /** 고객 선택 목록. 비어 있거나 null이면 `durationMin` 고정. FIXED에서는 항상 null */
  durationOptions: number[] | null;
  /** 준비 버퍼(분). 점유 구간에 포함, 고객 미표시 */
  bufferBeforeMin: number;
  /** 정리 버퍼(분). 점유 구간에 포함, 고객 미표시 */
  bufferAfterMin: number;
  /** 정원 스위치 — 슬롯당 예약 가능 인원. 연결 자원 capacity 최솟값 이하 */
  capacityPerSlot: number;
  /** 1건당 최대 인원 */
  maxPartySize: number;
  resourceSelectMode: ResourceSelectMode;
  /** ProductResource — 상품에 연결된 자원 id 목록 (활성/비활성 무관, 계산 시 isActive로 걸러낸다) */
  resourceIds: string[];
}

// ───────────────────────────── Resource ─────────────────────────────

export type ResourceType = "STAFF" | "SPACE" | "SHARED";

export interface SlotResource {
  id: string;
  type: ResourceType;
  /** 동시 수용 인원. 타입과 무관하게 N 허용 */
  capacity: number;
  isActive: boolean;
  sortOrder: number;
}

// ───────────────────────────── 근무 · 휴무 ─────────────────────────────

/** 주간 반복 근무 패턴 (STAFF 자원) */
export interface WorkSchedule {
  resourceId: string;
  dayOfWeek: Dow;
  startTime: LocalTime;
  /** `endTime ≤ startTime`이면 익일 */
  endTime: LocalTime;
  /** 최대 2구간 */
  breaks?: TimeRange[];
  effectiveFrom: ISODate;
  /** null이면 무기한 */
  effectiveTo: ISODate | null;
}

export type WorkExceptionKind = "OFF" | "MODIFIED" | "BLOCK" | "EXTRA";

/** 일자별 근무 예외 */
export interface WorkException {
  resourceId: string;
  /** 영업일 */
  date: ISODate;
  kind: WorkExceptionKind;
  /** kind=MODIFIED/BLOCK/EXTRA 에서 필수, OFF면 없음 */
  startTime?: LocalTime | null;
  /** `endTime ≤ startTime`이면 익일 */
  endTime?: LocalTime | null;
}

export type HolidayType = "ONCE" | "WEEKLY" | "MONTHLY_DAY" | "YEARLY";

export interface Holiday {
  /** null이면 사업장 전체 휴무, 값이 있으면 해당 자원만 */
  resourceId: string | null;
  type: HolidayType;
  /** ONCE: 기간 시작. YEARLY: 연도는 무시하고 월/일만 사용 */
  startDate: ISODate;
  /** ONCE: 기간 종료 (없으면 startDate 하루) */
  endDate?: ISODate | null;
  /** WEEKLY: 0(일)~6(토) */
  dayOfWeek?: Dow | null;
  /** MONTHLY_DAY: 1~31 */
  dayOfMonth?: number | null;
  /** MONTHLY_DAY 대신 "매월 말일" */
  isLastDayOfMonth?: boolean;
  /** YEARLY: 1~12 */
  month?: number | null;
  /** false면 부분 휴무 (startTime/endTime 필수) */
  isFullDay: boolean;
  startTime?: LocalTime | null;
  /** `endTime ≤ startTime`이면 익일 */
  endTime?: LocalTime | null;
  /** 반복 종료일 (반복 유형만) */
  repeatUntil?: ISODate | null;
}

// ───────────────────────────── Reservation ─────────────────────────────

export type ReservationStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELED_BY_USER"
  | "CANCELED_BY_BIZ"
  | "NO_SHOW"
  | "REJECTED"
  | "EXPIRED";

/** 점유 계산에 필요한 예약 투영. `occupyRange`는 버퍼가 이미 포함된 스냅샷이다 */
export interface ExistingReservation {
  id: string;
  resourceId: string;
  /** 같은 자원을 쓰는 다른 상품의 예약도 점유에 포함된다 (캐시 무효화 규칙 참조) */
  productId?: string;
  /** `[startAt − bufferBeforeMin, endAt + bufferAfterMin)` — 반열림 구간 */
  occupyRange: { start: ISODateTime; end: ISODateTime };
  partySize: number;
  /** REQUESTED · CONFIRMED만 점유로 친다 */
  status: ReservationStatus;
}

// ───────────────────────────── 입력 ─────────────────────────────

/** 계산에 필요한 모든 컨텍스트. DB 접근 없이 이 값만으로 결정적(deterministic)이어야 한다 */
export interface SlotContext {
  /** 현재 시각. `today = now AT TIME ZONE business.timezone` */
  now: ISODateTime;
  business: SlotBusiness;
  product: SlotProduct;
  /** `product.resourceIds`에 해당하는 자원 정의 */
  resources: SlotResource[];
  workSchedules: WorkSchedule[];
  workExceptions: WorkException[];
  holidays: Holiday[];
  /**
   * 예약 로드 범위 `[date 00:00 − (max(durationOptions ∪ {durationMin}) + bufferBefore + bufferAfter), (date + 2) 00:00)`
   * 안의 예약. 범위 밖 예약이 섞여 있어도 계산은 겹침으로 걸러내므로 결과가 달라지지 않아야 한다.
   */
  existingReservations: ExistingReservation[];
}

export interface SlotQuery {
  /** 영업일 `YYYY-MM-DD` (사업장 로컬) */
  date: ISODate;
  partySize: number;
  /** `durationOptions`가 있는 상품만 의미 있음. 미지정 시 `product.durationMin` */
  durationMin?: number;
  /** 지정 시 해당 자원만 계산. 미지정 시 연결 자원 전체를 계산하고 `mergeByStartTime`으로 합산 */
  resourceId?: string;
}

// ───────────────────────────── 출력 ─────────────────────────────

export interface Slot {
  /** = startAt */
  start: ISODateTime;
  /** = endAt (버퍼 제외) */
  end: ISODateTime;
  /** 이 시각에 가능한 자원. 자원 무관 조회 시 동일 시각을 합산했으므로 복수일 수 있다 */
  resourceIds: string[];
  /**
   * 잔여 정원 = Σ(자원별 cap − peakOccupancy), 요구 좌석 이상인 자원만 합산.
   * 주의: 합산이라 **한 건이 실제로 쓸 수 있는 최대 인원과 다르다** — 정원 2 짜리 방 셋이면 6 이지만 6명 예약은 들어가지 않는다.
   * 예약 생성(FR-BOOK-020)의 인원 검증은 이 합계가 아니라 자원별 잔여로 해야 한다 (LATER.md L-31).
   * cap = min(capacityPerSlot, resource.capacity)가 1이면 한 팀이 슬롯을 통째로 쓰므로 팀 단위(0 또는 1)이고
   * partySize와 비교하지 않는다 — 공간형 프리셋(정원 1, 최대 4명)이 성립하기 위한 해석 (tests/fixtures/README.md 가정 A1)
   */
  remaining: number;
}

/** FIXED 회차 제외 사유 (명세 "모드별 동작 차이") */
export type FixedExclusionReason = "LEAD_TIME" | "FULL" | "OUT_OF_WINDOW";

/** FIXED 상품에서 제외된 회차. 위젯이 "마감 / 임박 마감 / 운영 시간 외"를 구분해 표시한다 */
export interface ExcludedSlot {
  start: ISODateTime;
  end: ISODateTime;
  resourceId: string;
  reason: FixedExclusionReason;
  /** reason=FULL일 때 잔여(0 이상, partySize 미만). "잔여 N자리" 표시용 */
  remaining?: number;
}

export type SlotErrorCode =
  /** durationMin이 durationOptions 밖 — 400, 조용히 기본값으로 바꾸지 않는다. 확정된 이용 시간이 0 이하인 경우도 */
  | "DURATION_NOT_ALLOWED"
  /** partySize > product.maxPartySize */
  | "PARTY_SIZE_EXCEEDED"
  /** partySize가 1 미만이거나 정수가 아님 — 0을 넣으면 만석 슬롯도 "잔여 0 ≥ 0" 으로 통과한다 */
  | "PARTY_SIZE_INVALID"
  /** resourceSelectMode=REQUIRED인데 query.resourceId가 없음 */
  | "RESOURCE_REQUIRED"
  /** query.resourceId가 상품에 연결되지 않은 자원 */
  | "RESOURCE_NOT_LINKED";

export interface SlotSuccess {
  slots: Slot[];
  /** FIXED 상품에서만 채운다. FREE면 생략 */
  excluded?: ExcludedSlot[];
}

export interface SlotFailure {
  error: SlotErrorCode;
}

/** 입력 검증 실패는 throw 대신 `{ error }`로 돌려주고, API 계층이 400으로 매핑한다 */
export type SlotResult = SlotSuccess | SlotFailure;

export const isSlotFailure = (r: SlotResult): r is SlotFailure => "error" in r;

/** 구현 시그니처 (이슈 7-1·7-2에서 구현). 순수 함수 — 같은 입력이면 항상 같은 출력 */
export type ComputeSlots = (ctx: SlotContext, q: SlotQuery) => SlotResult;
