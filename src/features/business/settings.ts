import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businessSlugHistory, businesses, type OpeningHour } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { hashPii, writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { phoneSchema } from "@/features/auth/validation";
import { timeSchema, toMin } from "./hours";
import { RESERVED_SLUGS } from "./slug-rules";
import { BUSINESS_CATEGORY_CODES } from "./policy-defaults";

/**
 * 사업장 기본정보 · 영업시간 · slug (FR-BIZ-010, #26).
 *
 * 영업시간 규칙 (#26): 요일별 open/close "HH:MM", close ≤ open 이면 **익일 마감**으로 해석(심야 영업). 브레이크는 최대 2구간,
 * 영업시간 안에 있어야 하고 서로 겹치지 않는다. 요일이 배열에 없으면 그날은 휴무.
 * slug: 영소문자+숫자+하이픈 3~30자. 바꾸면 옛 slug 는 business_slug_history 에 영구 예약(다른 사업장이 못 쓴다) — 구 URL 301 의 근거.
 */
export { timeSchema, toMin } from "./hours";

export const openingHourSchema = z
  .object({
    dow: z.number().int().min(0).max(6),
    open: timeSchema,
    close: timeSchema,
    breaks: z.array(z.object({ start: timeSchema, end: timeSchema })).max(2, "휴게시간은 최대 2구간입니다").optional(),
  })
  .superRefine((h, ctx) => {
    const open = toMin(h.open);
    let close = toMin(h.close);
    if (close <= open) close += 24 * 60; // 익일 마감
    if (close - open > 24 * 60) ctx.addIssue({ code: "custom", path: ["close"], message: "영업시간은 24시간을 넘을 수 없습니다" });
    const spans = (h.breaks ?? []).map((b) => {
      let s = toMin(b.start);
      let e = toMin(b.end);
      if (s < open) s += 24 * 60; // 자정 넘긴 브레이크 (예: 01:00~02:00, 영업 20:00~04:00)
      if (e <= s) e += 24 * 60;
      return { s, e };
    });
    spans.forEach((b, i) => {
      if (b.s < open || b.e > close) ctx.addIssue({ code: "custom", path: ["breaks", i], message: "휴게시간은 영업시간 안에 있어야 합니다" });
    });
    if (spans.length === 2 && spans[0].s < spans[1].e && spans[1].s < spans[0].e) {
      ctx.addIssue({ code: "custom", path: ["breaks"], message: "휴게시간 두 구간이 겹칩니다" });
    }
  });

export const openingHoursSchema = z
  .array(openingHourSchema)
  .max(7)
  .refine((arr) => new Set(arr.map((h) => h.dow)).size === arr.length, "같은 요일이 두 번 들어 있습니다");

// 주소 규칙은 화면과 공용이라 순수 모듈에 있다 (`slug-rules.ts`) — 여기서 다시 적지 않는다
export { slugSchema } from "./slug-rules";

/** 30일 slug 변경 횟수 제한 — 옛 slug 가 영구 예약되므로 무제한이면 주소 선점(스쿼팅)에 쓰인다 */
export const SLUG_CHANGES_PER_30D = 3;

export const businessInfoSchema = z.object({
  name: z.string().trim().min(1, "상호를 입력해 주세요").max(100),
  category: z.enum(BUSINESS_CATEGORY_CODES),
  phone: phoneSchema.optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  addressDetail: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .default("Asia/Seoul")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "지원하지 않는 시간대입니다"),
  openingHours: openingHoursSchema,
});
export type BusinessInfoInput = z.infer<typeof businessInfoSchema>;

export type BusinessSettings = {
  id: string;
  slug: string;
  name: string;
  bizRegNo: string;
  category: string;
  phone: string | null;
  address: string | null;
  addressDetail: string | null;
  description: string | null;
  timezone: string;
  openingHours: OpeningHour[];
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "BLOCKED";
  rejectedReason: string | null;
};

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings> {
  const [b] = await db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      bizRegNo: businesses.bizRegNo,
      category: businesses.category,
      phone: businesses.phone,
      address: businesses.address,
      addressDetail: businesses.addressDetail,
      description: businesses.description,
      timezone: businesses.timezone,
      openingHours: businesses.openingHours,
      status: businesses.status,
      rejectedReason: businesses.rejectedReason,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  return b;
}

/**
 * 영업시간이 **뜻으로** 같은가.
 *
 * `JSON.stringify` 로 비교하면 안 된다 — jsonb 는 키 순서를 보존하지 않고 길이·바이트 순으로 다시 쓴다.
 * 지금은 `dow`(3) `open`(4) `close`(5) `breaks`(6) 가 우연히 스키마 순서와 같아 맞아떨어지지만,
 * 키를 하나 더하거나 이름을 바꾸는 순간 **안 바뀐 영업시간이 "변경됨" 으로 찍힌다.**
 * "바뀐 필드만 남긴다" 가 이 함수 하나에 걸려 있어서 뜻으로 비교한다:
 * 요일 순서·브레이크 순서는 의미가 없고, `breaks` 없음과 빈 배열은 같다.
 */
export function sameOpeningHours(a: OpeningHour[] | null | undefined, b: OpeningHour[] | null | undefined): boolean {
  const norm = (list: OpeningHour[] | null | undefined) =>
    [...(list ?? [])]
      .sort((x, y) => x.dow - y.dow)
      .map((h) => [h.dow, h.open, h.close, [...(h.breaks ?? [])].map((br) => `${br.start}~${br.end}`).sort().join(",")].join("|"))
      .join(";");
  return norm(a) === norm(b);
}

/** 감사 diff 에 원문을 남기지 않는 필드 — 연락처·주소는 해시로 대체한다 (FR-ADM-040) */
const HASHED_FIELDS = new Set(["phone", "address", "addressDetail"]);

/** 소개글처럼 긴 자유 입력은 "바뀌었다" 만 남긴다 — 2000자를 로그에 두 벌 복제할 이유가 없다 */
const LONG_FIELDS = new Set(["description", "openingHours"]);

function auditValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (HASHED_FIELDS.has(field)) return hashPii(String(value));
  if (LONG_FIELDS.has(field)) return "(변경됨)";
  return value;
}

/**
 * 사업장 기본정보 수정. **변경된 필드만** 감사 로그에 남기고, 연락처·주소는 해시로 대체한다 (FR-ADM-040, #56) —
 * 레코드를 통째로 담으면 연락처가 로그에 복제되어 마스킹 배치(FR-PRIV-010)의 사정권 밖에 남는다.
 *
 * diff 의 기준(before)을 같은 트랜잭션에서 잠그고 읽는다. 동시 저장이 서로의 변경을 감사 로그에서 지우지 않게 —
 * 정책 수정(`updatePolicy`)과 같은 수법이다.
 */
export async function updateBusinessInfo(businessId: string, input: BusinessInfoInput, actor?: { uid: string; role: "OWNER" | "MANAGER" }, meta?: RequestMeta): Promise<void> {
  const next = {
    name: input.name,
    category: input.category,
    phone: input.phone ?? null,
    address: input.address ?? null,
    addressDetail: input.addressDetail ?? null,
    description: input.description ?? null,
    timezone: input.timezone,
    openingHours: input.openingHours.slice().sort((a, b) => a.dow - b.dow),
  };
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: businesses.name, category: businesses.category, phone: businesses.phone, address: businesses.address, addressDetail: businesses.addressDetail, description: businesses.description, timezone: businesses.timezone, openingHours: businesses.openingHours })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1)
      .for("update");
    if (!before) throw new HttpError(404, "NOT_FOUND");

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(next) as Array<keyof typeof next>) {
      const a = before[k];
      const b = next[k];
      const same = k === "openingHours" ? sameOpeningHours(a as OpeningHour[], b as OpeningHour[]) : (a ?? null) === (b ?? null);
      if (same) continue;
      diff[k] = { from: auditValue(k, a), to: auditValue(k, b) };
    }
    if (Object.keys(diff).length === 0) return;

    await tx.update(businesses).set(next).where(eq(businesses.id, businessId));
    // 배치·마이그레이션 등 행위자가 없는 경로도 있으므로 actor 는 선택이다
    await writeAudit({ action: "BUSINESS_UPDATE", actorId: actor?.uid ?? null, actorRole: actor?.role ?? "SYSTEM", businessId, targetType: "BUSINESS", targetId: businessId, diff, meta }, tx);
  });
}

export type SlugChangeResult = { ok: true; slug: string } | { ok: false; reason: "TAKEN" | "RESERVED" | "SAME" | "LIMIT" };

/** slug 변경. 옛 slug 는 history 에 그대로 남아 영구 예약된다(한 번 쓰인 slug 는 다른 사업장이 못 쓴다). */
export async function changeSlug(businessId: string, slug: string, actor: { uid: string; role: "OWNER" | "MANAGER" }, meta: RequestMeta): Promise<SlugChangeResult> {
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "RESERVED" };
  return db.transaction(async (tx) => {
    // 사업장 행을 잠근다 — 같은 사업장의 동시 변경이 30일 제한을 넘거나 history 를 두 번 쓰지 않도록
    const [cur] = await tx.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, businessId)).limit(1).for("update");
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    if (cur.slug === slug) return { ok: false, reason: "SAME" } as const;
    // 다른 사업장이 쓰(었)던 slug 는 거절. 우리 사업장의 옛 slug 로 되돌리는 건 허용
    const [taken] = await tx
      .select({ id: businessSlugHistory.id })
      .from(businessSlugHistory)
      .where(and(eq(businessSlugHistory.slug, slug), ne(businessSlugHistory.businessId, businessId)))
      .limit(1);
    if (taken) return { ok: false, reason: "TAKEN" } as const;
    const [{ recent }] = await tx
      .select({ recent: sql<number>`count(*)::int` })
      .from(businessSlugHistory)
      // 가입 때 자동으로 받은 임시 slug(b-…) 는 세지 않는다
      .where(and(eq(businessSlugHistory.businessId, businessId), gt(businessSlugHistory.createdAt, sql`now() - interval '30 days'`), sql`${businessSlugHistory.slug} not like 'b-%'`));
    if (recent >= SLUG_CHANGES_PER_30D) return { ok: false, reason: "LIMIT" } as const;
    await tx.update(businesses).set({ slug }).where(eq(businesses.id, businessId));
    const [mine] = await tx
      .select({ id: businessSlugHistory.id })
      .from(businessSlugHistory)
      .where(and(eq(businessSlugHistory.slug, slug), eq(businessSlugHistory.businessId, businessId)))
      .limit(1);
    if (!mine) await tx.insert(businessSlugHistory).values({ businessId, slug });
    await writeAudit({ action: "BUSINESS_UPDATE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "BUSINESS", targetId: businessId, diff: { slug: { from: cur.slug, to: slug } }, meta }, tx);
    return { ok: true, slug } as const;
  });
}

/** 위저드 1단계 "매장 정보" 완료 판정 — 공개 조건 패널·사이드바에 쓴다 */
export function isInfoComplete(b: Pick<BusinessSettings, "name" | "phone" | "address" | "openingHours" | "slug">): boolean {
  return Boolean(b.name && b.phone && b.address && b.openingHours.length > 0 && !b.slug.startsWith("b-"));
}
