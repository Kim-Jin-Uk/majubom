/**
 * tests/fixtures/slot-cases.json 검증용 zod 스키마.
 *
 * 각 스키마는 `z.ZodType<T>`로 src/features/booking/slot-types.ts 의 타입에 고정돼 있어,
 * 타입 파일의 필드가 바뀌면 여기서 컴파일 오류가 난다 (픽스처 ↔ 타입 동기화 장치).
 */
import { z } from "zod";
import type {
  Dow,
  ExcludedSlot,
  ExistingReservation,
  FixedStartTimesEntry,
  Holiday,
  OpeningHoursEntry,
  Slot,
  SlotBusiness,
  SlotContext,
  SlotFailure,
  SlotProduct,
  SlotQuery,
  SlotResource,
  SlotResult,
  SlotSuccess,
  TimeRange,
  WorkException,
  WorkSchedule,
} from "@/features/booking/slot-types";

// ───────── 스칼라 ─────────
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");
/** 오프셋 필수 — 'Z' 나 오프셋 없는 로컬 표기는 거부한다 */
export const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d[+-]\d{2}:\d{2}$/, "ISO 8601 with offset")
  .refine((s) => !Number.isNaN(Date.parse(s)), "parseable datetime");
export const dow: z.ZodType<Dow> = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6),
]);
const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

export const timeRange: z.ZodType<TimeRange> = z.object({ start: localTime, end: localTime });

// ───────── Business ─────────
export const openingHoursEntry: z.ZodType<OpeningHoursEntry> = z.object({
  dow,
  open: localTime,
  close: localTime,
  breaks: z.array(timeRange).max(2).optional(),
});

export const slotBusiness: z.ZodType<SlotBusiness> = z.object({
  timezone: z.string().min(1),
  openingHours: z.array(openingHoursEntry),
  policy: z.object({ minLeadTimeMin: nonNegInt, maxAdvanceDays: nonNegInt }),
});

// ───────── Product ─────────
export const fixedStartTimesEntry: z.ZodType<FixedStartTimesEntry> = z.object({
  dow,
  times: z.array(localTime).min(1).max(12),
});

const slotProductBase = z.object({
  id: z.string().min(1),
  startMode: z.enum(["FREE", "FIXED"]),
  fixedStartTimes: z.array(fixedStartTimesEntry).nullable(),
  fixedIgnoreBreaks: z.boolean().optional(),
  slotIntervalMin: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).nullable(),
  durationMin: z.number().int().min(5).max(480).multipleOf(5),
  durationOptions: z.array(positiveInt).max(6).nullable(),
  bufferBeforeMin: z.number().int().min(0).max(60),
  bufferAfterMin: z.number().int().min(0).max(60),
  capacityPerSlot: positiveInt,
  maxPartySize: positiveInt,
  resourceSelectMode: z.enum(["REQUIRED", "OPTIONAL", "AUTO", "NONE"]),
  resourceIds: z.array(z.string().min(1)).min(1),
});

/** Product CHECK 제약(§2.2)까지 재현 */
export const slotProduct: z.ZodType<SlotProduct> = slotProductBase.superRefine((p, ctx) => {
  if (p.startMode === "FIXED") {
    if (!p.fixedStartTimes) ctx.addIssue({ code: "custom", message: "FIXED 는 fixedStartTimes 필수", path: ["fixedStartTimes"] });
    if (p.durationOptions) ctx.addIssue({ code: "custom", message: "FIXED 는 durationOptions 사용 불가", path: ["durationOptions"] });
  } else {
    if (p.slotIntervalMin === null) ctx.addIssue({ code: "custom", message: "FREE 는 slotIntervalMin 필수", path: ["slotIntervalMin"] });
    if (p.fixedStartTimes) ctx.addIssue({ code: "custom", message: "FREE 는 fixedStartTimes null", path: ["fixedStartTimes"] });
  }
  if (p.durationOptions && !p.durationOptions.includes(p.durationMin)) {
    ctx.addIssue({ code: "custom", message: "durationMin ∈ durationOptions", path: ["durationMin"] });
  }
});

// ───────── Resource ─────────
export const slotResource: z.ZodType<SlotResource> = z.object({
  id: z.string().min(1),
  type: z.enum(["STAFF", "SPACE", "SHARED"]),
  capacity: positiveInt,
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

// ───────── 근무 · 휴무 ─────────
export const workSchedule: z.ZodType<WorkSchedule> = z.object({
  resourceId: z.string().min(1),
  dayOfWeek: dow,
  startTime: localTime,
  endTime: localTime,
  breaks: z.array(timeRange).max(2).optional(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
});

export const workException: z.ZodType<WorkException> = z
  .object({
    resourceId: z.string().min(1),
    date: isoDate,
    kind: z.enum(["OFF", "MODIFIED", "BLOCK", "EXTRA"]),
    startTime: localTime.nullable().optional(),
    endTime: localTime.nullable().optional(),
  })
  .superRefine((w, ctx) => {
    if (w.kind !== "OFF" && (!w.startTime || !w.endTime)) {
      ctx.addIssue({ code: "custom", message: `${w.kind} 는 startTime/endTime 필수`, path: ["startTime"] });
    }
  });

export const holiday: z.ZodType<Holiday> = z
  .object({
    resourceId: z.string().min(1).nullable(),
    type: z.enum(["ONCE", "WEEKLY", "MONTHLY_DAY", "YEARLY"]),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    dayOfWeek: dow.nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    isLastDayOfMonth: z.boolean().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    isFullDay: z.boolean(),
    startTime: localTime.nullable().optional(),
    endTime: localTime.nullable().optional(),
    repeatUntil: isoDate.nullable().optional(),
  })
  .superRefine((h, ctx) => {
    if (!h.isFullDay && (!h.startTime || !h.endTime)) {
      ctx.addIssue({ code: "custom", message: "부분 휴무는 startTime/endTime 필수", path: ["startTime"] });
    }
    if (h.type === "WEEKLY" && h.dayOfWeek == null) ctx.addIssue({ code: "custom", message: "WEEKLY 는 dayOfWeek 필수", path: ["dayOfWeek"] });
    if (h.type === "MONTHLY_DAY" && h.dayOfMonth == null && !h.isLastDayOfMonth) {
      ctx.addIssue({ code: "custom", message: "MONTHLY_DAY 는 dayOfMonth 또는 isLastDayOfMonth", path: ["dayOfMonth"] });
    }
    if (h.type === "YEARLY" && h.month == null) ctx.addIssue({ code: "custom", message: "YEARLY 는 month 필수", path: ["month"] });
  });

// ───────── Reservation ─────────
export const reservationStatus = z.enum([
  "REQUESTED", "CONFIRMED", "COMPLETED", "CANCELED_BY_USER", "CANCELED_BY_BIZ", "NO_SHOW", "REJECTED", "EXPIRED",
]);

export const existingReservation: z.ZodType<ExistingReservation> = z
  .object({
    id: z.string().min(1),
    resourceId: z.string().min(1),
    productId: z.string().min(1).optional(),
    occupyRange: z.object({ start: isoDateTime, end: isoDateTime }),
    partySize: positiveInt,
    status: reservationStatus,
  })
  .refine((r) => Date.parse(r.occupyRange.start) < Date.parse(r.occupyRange.end), {
    message: "occupyRange.start < end",
    path: ["occupyRange"],
  });

// ───────── 입력 ─────────
export const slotContext: z.ZodType<SlotContext> = z.object({
  now: isoDateTime,
  business: slotBusiness,
  product: slotProduct,
  resources: z.array(slotResource).min(1),
  workSchedules: z.array(workSchedule),
  workExceptions: z.array(workException),
  holidays: z.array(holiday),
  existingReservations: z.array(existingReservation),
});

export const slotQuery: z.ZodType<SlotQuery> = z.object({
  date: isoDate,
  partySize: positiveInt,
  durationMin: positiveInt.optional(),
  resourceId: z.string().min(1).optional(),
});

// ───────── 출력 ─────────
export const slot: z.ZodType<Slot> = z
  .object({
    start: isoDateTime,
    end: isoDateTime,
    resourceIds: z.array(z.string().min(1)).min(1),
    remaining: positiveInt,
  })
  .refine((s) => Date.parse(s.start) < Date.parse(s.end), { message: "start < end", path: ["end"] });

export const excludedSlot: z.ZodType<ExcludedSlot> = z.object({
  start: isoDateTime,
  end: isoDateTime,
  resourceId: z.string().min(1),
  reason: z.enum(["LEAD_TIME", "FULL", "OUT_OF_WINDOW"]),
  remaining: nonNegInt.optional(),
});

export const slotSuccess: z.ZodType<SlotSuccess> = z.object({
  slots: z.array(slot),
  excluded: z.array(excludedSlot).optional(),
});

export const slotFailure: z.ZodType<SlotFailure> = z.object({
  error: z.enum(["DURATION_NOT_ALLOWED", "PARTY_SIZE_EXCEEDED", "RESOURCE_REQUIRED", "RESOURCE_NOT_LINKED"]),
});

export const slotResult: z.ZodType<SlotResult> = z.union([slotSuccess, slotFailure]);

// ───────── 케이스 · 파일 ─────────
/** README 의 태그 어휘. 새 태그는 여기와 README 에 함께 추가한다 */
export const caseTag = z.enum([
  "free", "fixed", "staff", "space", "shared",
  "midnight", "buffer", "capacity-1", "capacity-n", "closure",
  "duration-options", "resource-assign", "boundary", "status", "error",
]);
export type CaseTag = z.infer<typeof caseTag>;

export const slotCase = z.object({
  id: z.string().regex(/^S\d{2}$/, "S01 형식"),
  title: z.string().min(1),
  tags: z.array(caseTag).min(1),
  rationale: z.string().min(10),
  ctx: slotContext,
  query: slotQuery,
  expected: slotResult,
});
export type SlotCase = z.infer<typeof slotCase>;

export const slotCasesFile = z.object({
  description: z.string(),
  spec: z.string(),
  timezone: z.literal("Asia/Seoul"),
  cases: z.array(slotCase),
});
export type SlotCasesFile = z.infer<typeof slotCasesFile>;
