import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAtOnly, timestamps, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { holidayTypeEnum, shiftSwapStatusEnum, swapTypeEnum, workExceptionKindEnum } from "./enums";
import { resources } from "./resources";
import { users } from "./users";

/** 휴게시간 구간. Business.openingHours.breaks 와 같은 형식. */
export type BreakRange = { start: string; end: string };

/** Holiday — 휴무일. resource_id 가 null 이면 사업장 전체 휴무. */
export const holidays = pgTable(
  "holidays",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    resourceId: uuid("resource_id").references(() => resources.id),
    type: holidayTypeEnum("type").notNull(),
    startDate: date("start_date").notNull(),
    /** ONCE 기간 휴무의 종료일. 단일일이면 start_date 와 같다. */
    endDate: date("end_date"),
    /** WEEKLY: 0(일)~6(토) */
    dayOfWeek: integer("day_of_week"),
    /** MONTHLY_DAY: 1~31 */
    dayOfMonth: integer("day_of_month"),
    /** MONTHLY_DAY 대신 "매월 말일" */
    isLastDayOfMonth: boolean("is_last_day_of_month").notNull().default(false),
    /** YEARLY: 1~12. start_date 의 연도는 무시하고 월/일만 사용 */
    month: integer("month"),
    isFullDay: boolean("is_full_day").notNull().default(true),
    startTime: time("start_time"),
    endTime: time("end_time"),
    repeatUntil: date("repeat_until"),
    memo: varchar("memo", { length: 100 }),
    ...createdAtOnly,
  },
  (t) => [
    check("holidays_day_of_week_range", sql`${t.dayOfWeek} IS NULL OR ${t.dayOfWeek} BETWEEN 0 AND 6`),
    check("holidays_day_of_month_range", sql`${t.dayOfMonth} IS NULL OR ${t.dayOfMonth} BETWEEN 1 AND 31`),
    check("holidays_month_range", sql`${t.month} IS NULL OR ${t.month} BETWEEN 1 AND 12`),
    check("holidays_date_order", sql`${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
    check(
      "holidays_partial_needs_times",
      sql`${t.isFullDay} OR (${t.startTime} IS NOT NULL AND ${t.endTime} IS NOT NULL AND ${t.startTime} < ${t.endTime})`,
    ),
    index("holidays_business_idx").on(t.businessId, t.startDate),
  ],
);

/**
 * WorkSchedule — 주간 반복 근무 패턴 (STAFF 자원).
 * 같은 자원·같은 요일의 패턴 적용 기간은 겹칠 수 없다 — EXCLUDE 제약 `work_schedule_no_overlap`
 * (drizzle-kit 이 표현하지 못해 drizzle/0001_constraints.sql 에 있다).
 * effective_to = NULL 은 "종료일 미정" — daterange(effective_from, NULL, '[]') 은 상한 무한.
 */
export const workSchedules = pgTable(
  "work_schedules",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** 최대 2구간 (앱 검증) */
    breaks: jsonb("breaks").$type<BreakRange[]>().notNull().default([]),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...timestamps,
  },
  (t) => [
    check("work_schedules_day_of_week_range", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check("work_schedules_time_order", sql`${t.startTime} < ${t.endTime}`),
    check("work_schedules_effective_order", sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} <= ${t.effectiveTo}`),
    index("work_schedules_resource_idx").on(t.resourceId, t.dayOfWeek),
  ],
);

/** WorkException — 일자별 근무 예외 (근무표 수정, 개인 차단시간). */
export const workExceptions = pgTable(
  "work_exceptions",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    date: date("date").notNull(),
    kind: workExceptionKindEnum("kind").notNull(),
    /** kind=MODIFIED/BLOCK/EXTRA 일 때 */
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: varchar("reason", { length: 200 }),
    /** 본인 등록 vs 사업자 편성 구분 */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...createdAtOnly,
  },
  (t) => [
    check(
      "work_exceptions_times_by_kind",
      sql`(${t.kind} = 'OFF') OR (${t.startTime} IS NOT NULL AND ${t.endTime} IS NOT NULL AND ${t.startTime} < ${t.endTime})`,
    ),
    index("work_exceptions_resource_date_idx").on(t.resourceId, t.date),
  ],
);

/** ShiftSwapRequest — 근무 교대 (FR-SHIFT-010/020). */
export const shiftSwapRequests = pgTable(
  "shift_swap_requests",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    requesterResourceId: uuid("requester_resource_id")
      .notNull()
      .references(() => resources.id),
    targetResourceId: uuid("target_resource_id")
      .notNull()
      .references(() => resources.id),
    /** 교대 대상 근무일 */
    requestDate: date("request_date").notNull(),
    swapType: swapTypeEnum("swap_type").notNull(),
    /** EXCHANGE 일 때 상대 근무일 */
    targetDate: date("target_date"),
    reason: text("reason").notNull(),
    status: shiftSwapStatusEnum("status").notNull().default("PENDING"),
    /** 요청자의 request_date 예약을 대상에게 이관할지 */
    reassignRequester: boolean("reassign_requester").notNull().default(false),
    /** EXCHANGE 일 때 대상의 target_date 예약을 요청자에게 이관할지 */
    reassignTarget: boolean("reassign_target"),
    /** 요청 생성 시점의 대상 예약 id 스냅샷. 승인 시 재조회 결과와 다르면 승인 중단 */
    reservationIdsAtRequest: jsonb("reservation_ids_at_request").$type<string[]>().notNull().default([]),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("shift_swap_distinct_resources", sql`${t.requesterResourceId} <> ${t.targetResourceId}`),
    check("shift_swap_exchange_needs_target_date", sql`${t.swapType} = 'GIVE' OR ${t.targetDate} IS NOT NULL`),
    index("shift_swap_requests_business_status_idx").on(t.businessId, t.status),
    index("shift_swap_requests_target_idx").on(t.targetResourceId, t.status),
  ],
);
