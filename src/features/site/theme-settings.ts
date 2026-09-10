import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businesses, sitePages, type SiteColorScheme } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { DEFAULT_SITE_THEME, SITE_COLOR_SCHEMES, normalizeColorScheme } from "./theme";

/**
 * 사업자가 고른 공개 홈 밝기의 저장 (#76). 읽기는 `public-home.ts` 가 사업장 한 행과 같이 가져간다.
 *
 * **행을 만들 때 `is_published` 는 반드시 true 다.** 공개 여부는 `coalesce(sp.is_published, true)` 로
 * 판정한다 — 행이 없으면 시작 템플릿으로 공개다. 밝기를 바꾸겠다고 기본값(false)으로 행을 만들면
 * 그 순간 가게가 조용히 404 가 된다. 밝기 선택은 발행 상태를 건드리는 동작이 아니다.
 */

export const siteThemeSchema = z.object({ colorScheme: z.enum(SITE_COLOR_SCHEMES) });
export type SiteThemeInput = z.infer<typeof siteThemeSchema>;

export async function getSiteColorScheme(businessId: string): Promise<SiteColorScheme> {
  const [row] = await db.select({ theme: sitePages.theme }).from(sitePages).where(eq(sitePages.businessId, businessId)).limit(1);
  return normalizeColorScheme(row?.theme?.colorScheme);
}

/** 바뀐 것이 없으면 아무것도 쓰지 않는다 (감사 로그가 같은 값으로 채워지지 않게) */
export async function updateSiteColorScheme(
  businessId: string,
  colorScheme: SiteColorScheme,
  actor: { uid: string; role: "OWNER" | "MANAGER" },
  meta: RequestMeta,
): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    // **사업장 행을 먼저 잠근다.** site_pages 행은 아직 없을 수 있고, 없는 행에 걸린 `for update` 는 아무것도 잠그지 않는다 —
    // 동시에 들어온 두 요청이 둘 다 before=AUTO 를 읽고 감사 로그를 두 줄 남긴다. 항상 있는 행에 건다 (changeSlug 와 같은 수법)
    const [biz] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1).for("update");
    if (!biz) throw new HttpError(404, "NOT_FOUND");
    const [row] = await tx.select({ theme: sitePages.theme }).from(sitePages).where(eq(sitePages.businessId, businessId)).limit(1);
    const before = normalizeColorScheme(row?.theme?.colorScheme);
    if (before === colorScheme) return { changed: false };
    await tx
      .insert(sitePages)
      .values({ businessId, draftData: { sections: [] }, theme: { ...DEFAULT_SITE_THEME, colorScheme }, isPublished: true })
      // 행이 이미 있으면 theme 의 나머지 키(빌더가 쓸 색·반경·폭)는 건드리지 않는다
      .onConflictDoUpdate({
        target: sitePages.businessId,
        set: { theme: sql`jsonb_set(coalesce(${sitePages.theme}, '{}'::jsonb), '{colorScheme}', to_jsonb(${colorScheme}::text), true)`, updatedAt: new Date() },
      });
    await writeAudit({ action: "BUSINESS_UPDATE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "BUSINESS", targetId: businessId, diff: { siteColorScheme: { from: before, to: colorScheme } }, meta }, tx);
    return { changed: true };
  });
}
