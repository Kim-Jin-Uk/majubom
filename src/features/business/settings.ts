import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businessSlugHistory, businesses, type OpeningHour } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { phoneSchema } from "@/features/auth/validation";
import { timeSchema, toMin } from "./hours";
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

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,30}$/, "영소문자·숫자·하이픈 3~30자")
  .refine((s) => !s.startsWith("-") && !s.endsWith("-"), "하이픈으로 시작하거나 끝날 수 없습니다")
  .refine((s) => !s.startsWith("b-"), "b- 로 시작하는 주소는 임시 주소용입니다");

/** 예약어 — 공개 URL /@{slug} 와 충돌하거나 오해를 부르는 것 */
const RESERVED_SLUGS = new Set(["admin", "console", "api", "login", "signup", "me", "majubom", "help", "about", "www", "app", "static", "_next", "support", "terms", "privacy", "notice", "official", "assets", "sitemap", "invite", "reset-password", "forgot-password"]);

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

export async function updateBusinessInfo(businessId: string, input: BusinessInfoInput): Promise<void> {
  const rows = await db
    .update(businesses)
    .set({
      name: input.name,
      category: input.category,
      phone: input.phone ?? null,
      address: input.address ?? null,
      addressDetail: input.addressDetail ?? null,
      description: input.description ?? null,
      timezone: input.timezone,
      openingHours: input.openingHours.slice().sort((a, b) => a.dow - b.dow),
    })
    .where(eq(businesses.id, businessId))
    .returning({ id: businesses.id });
  if (rows.length !== 1) throw new HttpError(404, "NOT_FOUND");
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
    await writeAudit({ action: "POLICY_UPDATE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "BUSINESS", targetId: businessId, diff: { slug: { from: cur.slug, to: slug } }, meta }, tx);
    return { ok: true, slug } as const;
  });
}

/** 위저드 1단계 "매장 정보" 완료 판정 — 공개 조건 패널·사이드바에 쓴다 */
export function isInfoComplete(b: Pick<BusinessSettings, "name" | "phone" | "address" | "openingHours" | "slug">): boolean {
  return Boolean(b.name && b.phone && b.address && b.openingHours.length > 0 && !b.slug.startsWith("b-"));
}
