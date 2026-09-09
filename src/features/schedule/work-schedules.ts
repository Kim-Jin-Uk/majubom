import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { isoDateSchema as dateSchema } from "@/lib/dates";
import { db, type DbLike } from "@/db/client";
import { businesses, resources, workSchedules, type BreakRange } from "@/db/schema";
import type { WorkSchedule } from "@/features/booking/slot-types";
import { HttpError } from "@/features/auth/errors";
import { timeSchema, toMin } from "@/features/business/hours";
import { addDays, span, subtract } from "./resolve";

/**
 * 주간 근무 패턴 (FR-SCH-020 WorkSchedule, #39). STAFF 자원 × 요일 × 적용 기간.
 *
 * 패턴은 "덮어쓰기" 가 아니라 **버전**이다: 새 패턴을 effectiveFrom 부터 적용하면 그 자원·요일의 열린 행(effectiveTo NULL 또는 ≥ from)은
 * effectiveTo = from − 1일 로 닫고(이력 보존), from 이후에 시작하는 행은 지운다(뒤집힌 기간이 생기니까). 그런 다음 새 행을 넣는다.
 * DB 의 EXCLUDE 제약(work_schedule_no_overlap)이 같은 자원·요일의 기간 겹침을 막는다 — 위 순서를 지키고 자원 행을 잠가 직렬화하면 걸리지 않고, 걸리면 23P01 → 409 (handle).
 * 요일 하나의 근무는 한 구간(시작<끝, 익일 불가 — DB CHECK) + 휴게 최대 2구간. 영업시간 밖 근무는 저장하되 warnings 로 알린다.
 */

export const patternDaySchema = z
  .object({
    dow: z.number().int().min(0).max(6),
    startTime: timeSchema,
    endTime: timeSchema,
    breaks: z.array(z.object({ start: timeSchema, end: timeSchema })).max(2, "휴게시간은 최대 2구간").default([]),
  })
  .superRefine((d, ctx) => {
    const s = toMin(d.startTime);
    const e = toMin(d.endTime);
    if (e <= s) ctx.addIssue({ code: "custom", path: ["endTime"], message: "근무 끝은 시작보다 뒤여야 합니다 (자정을 넘기는 근무는 다음 단계)" });
    d.breaks.forEach((b, i) => {
      const bs = toMin(b.start);
      const be = toMin(b.end);
      if (be <= bs || bs < s || be > e) ctx.addIssue({ code: "custom", path: ["breaks", i], message: "휴게는 근무시간 안에 있어야 합니다" });
    });
    if (d.breaks.length === 2) {
      const [a, b] = d.breaks.map((x) => ({ s: toMin(x.start), e: toMin(x.end) }));
      if (a.s < b.e && b.s < a.e) ctx.addIssue({ code: "custom", path: ["breaks"], message: "휴게 두 구간이 겹칩니다" });
    }
  });

export const patternInputSchema = z.object({
  /** 이 날부터 적용. 오늘 이후만 — 과거부터 적용하면 이미 지난 날의 버전이 지워진다(이력 훼손). setPattern 이 400 으로 거부 */
  effectiveFrom: dateSchema,
  /** 비어 있으면 "이 날부터 근무 없음" */
  days: z
    .array(patternDaySchema)
    .max(7)
    .refine((arr) => new Set(arr.map((d) => d.dow)).size === arr.length, "같은 요일이 두 번 들어 있습니다"),
});
export type PatternInput = z.output<typeof patternInputSchema>;

export const bulkPatternInputSchema = patternInputSchema.extend({ resourceIds: z.array(z.uuid()).min(1).max(50) });

export type PatternRow = WorkSchedule & { id: string };

export type PatternView = {
  resourceId: string;
  /** 오늘 기준 유효한 요일별 패턴 */
  current: PatternRow[];
  /** 오늘 이후에 시작하는 예정 패턴 */
  upcoming: PatternRow[];
  /** 끝난 패턴 (최근 것부터, 최대 50) */
  history: PatternRow[];
};

function toRow(r: typeof workSchedules.$inferSelect): PatternRow {
  return {
    id: r.id,
    resourceId: r.resourceId,
    dayOfWeek: r.dayOfWeek as WorkSchedule["dayOfWeek"],
    startTime: r.startTime.slice(0, 5),
    endTime: r.endTime.slice(0, 5),
    breaks: r.breaks,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  };
}

export async function getPatterns(businessId: string, resourceId: string, today: string): Promise<PatternView> {
  // 타 사업장 자원은 404 — PUT/bulk 와 같은 규칙 (빈 배열 200 으로 존재를 흘리지 않는다)
  const [r] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), eq(resources.businessId, businessId))).limit(1);
  if (!r) throw new HttpError(404, "NOT_FOUND");
  const rows = await db
    .select()
    .from(workSchedules)
    .where(and(eq(workSchedules.businessId, businessId), eq(workSchedules.resourceId, resourceId)))
    .orderBy(desc(workSchedules.effectiveFrom), asc(workSchedules.dayOfWeek));
  const all = rows.map(toRow);
  return {
    resourceId,
    current: all.filter((r) => r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo >= today)).sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    upcoming: all.filter((r) => r.effectiveFrom > today),
    history: all.filter((r) => r.effectiveTo !== null && r.effectiveTo < today).slice(0, 50),
  };
}

/** 기간에 걸리는 패턴 전부 (캘린더 계산용) */
export async function schedulesForRange(businessId: string, from: string, to: string, q: DbLike = db): Promise<WorkSchedule[]> {
  const rows = await q
    .select()
    .from(workSchedules)
    .where(and(eq(workSchedules.businessId, businessId), sql`${workSchedules.effectiveFrom} <= ${to}`, or(isNull(workSchedules.effectiveTo), gte(workSchedules.effectiveTo, from))));
  return rows.map(toRow);
}

export type PatternWarning = { resourceId: string; dow: number; reason: "OUTSIDE_OPENING" | "CLOSED_DAY" };

/**
 * 패턴 적용. resourceIds 여러 개면 같은 패턴을 일괄 적용(FR-SCH-020 "일괄 편집"). STAFF 자원만.
 * 이전 패턴은 effectiveTo 를 먼저 닫는다 — EXCLUDE 제약이 겹침을 막고 있어서 순서가 중요하다.
 */
export async function setPattern(businessId: string, resourceIds: string[], input: PatternInput, today: string): Promise<{ warnings: PatternWarning[]; replacedUpcoming: number }> {
  // 과거 날짜부터 적용하면 이미 지난 날을 다스린 버전이 지워진다(이력 훼손) — 오늘 이후만
  if (input.effectiveFrom < today) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["effectiveFrom"], message: "적용 시작일은 오늘 이후여야 합니다" }] });
  return db.transaction(async (tx) => {
    const ids = [...new Set(resourceIds)];
    // 자원 행을 잠근다 — 같은 담당자의 동시 저장이 EXCLUDE 제약에 걸려 500 이 되지 않도록 직렬화
    const rs = await tx
      .select({ id: resources.id, type: resources.type })
      .from(resources)
      .where(and(eq(resources.businessId, businessId), inArray(resources.id, ids)))
      .for("update");
    if (rs.length !== ids.length) throw new HttpError(404, "NOT_FOUND");
    if (rs.some((r) => r.type !== "STAFF")) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["resourceIds"], message: "근무표는 담당자(STAFF) 자원에만 있습니다. 공간·공용 자원은 영업시간을 따릅니다" }] });
    const [b] = await tx.select({ openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!b) throw new HttpError(404, "NOT_FOUND");

    const from = input.effectiveFrom;
    const dayBefore = addDays(from, -1);
    const warnings: PatternWarning[] = [];
    let replacedUpcoming = 0;
    for (const rid of ids) {
      // 1) from 이후에 시작하는(예정) 행은 지운다 (닫으면 from-1 < effectiveFrom 인 뒤집힌 기간이 된다). 몇 개였는지 알려준다
      const gone = await tx.delete(workSchedules).where(and(eq(workSchedules.resourceId, rid), eq(workSchedules.businessId, businessId), gte(workSchedules.effectiveFrom, from))).returning({ id: workSchedules.id });
      replacedUpcoming += gone.length;
      // 2) 열린 행(NULL 또는 from 이후까지)은 from-1 로 닫는다 — 이력 보존
      await tx
        .update(workSchedules)
        .set({ effectiveTo: dayBefore })
        .where(and(eq(workSchedules.resourceId, rid), eq(workSchedules.businessId, businessId), or(isNull(workSchedules.effectiveTo), gte(workSchedules.effectiveTo, from))));
      // 3) 새 행
      if (input.days.length) {
        await tx.insert(workSchedules).values(
          input.days.map((d) => ({ businessId, resourceId: rid, dayOfWeek: d.dow, startTime: d.startTime, endTime: d.endTime, breaks: d.breaks as BreakRange[], effectiveFrom: from, effectiveTo: null })),
        );
      }
      for (const d of input.days) {
        const o = b.openingHours.find((x) => x.dow === d.dow);
        if (!o) warnings.push({ resourceId: rid, dow: d.dow, reason: "CLOSED_DAY" });
        else if (subtract([span(d.startTime, d.endTime)], [span(o.open, o.close)]).length > 0) warnings.push({ resourceId: rid, dow: d.dow, reason: "OUTSIDE_OPENING" });
      }
    }
    return { warnings, replacedUpcoming };
  });
}
