import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessSlugHistory, businesses, productResources, products, resources, sitePages, users, workSchedules } from "@/db/schema";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { loadPublicHome } from "@/features/site/public-home";
import { getSiteColorScheme, updateSiteColorScheme } from "@/features/site/theme-settings";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 공개 홈 밝기 (#76). 여기서 지키는 것은 하나다 —
 * **밝기를 고르는 것이 가게를 닫아서는 안 된다.**
 *
 * 공개 여부는 `coalesce(site_pages.is_published, true)` 로 판정한다(행이 없으면 시작 템플릿으로 공개).
 * 그런데 밝기는 `site_pages.theme` 에 산다. 행을 만들면서 `is_published` 를 컬럼 기본값(false)에 맡기면
 * 사장님이 "다크로 바꿔 볼까" 한 순간 가게가 404 가 된다. 조용히, 아무 메시지 없이.
 */
const TZ = "Asia/Seoul";

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `theme-${tag}`,
      name: `밝기 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "nail",
      status: "APPROVED",
      timezone: TZ,
      phone: "02-123-4567",
      address: "서울 마포구 어딘가로 1",
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "09:00", close: "18:00" })),
      policy: DEFAULT_POLICY,
    })
    .returning({ id: businesses.id, slug: businesses.slug });
  await db.insert(businessSlugHistory).values({ businessId: biz.id, slug: biz.slug });
  const [staff] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "디자이너", capacity: 1 }).returning({ id: resources.id });
  await db.insert(workSchedules).values([0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId: staff.id, dayOfWeek, startTime: "09:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01" })));
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "젤네일", images: [], startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: staff.id });
  const [owner] = await db.insert(users).values({ email: `o-${tag}@test.local`, name: "사장님", provider: "LOCAL" }).returning({ id: users.id });
  return { businessId: biz.id, productId: prd.id, ownerId: owner.id };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

const actor = (uid: string) => ({ uid, role: "OWNER" as const });
const meta = { ip: null, userAgent: null };

describe.skipIf(!dbTestEnabled())("공개 홈 밝기 (#76)", () => {
  afterAll(async () => {
    for (const f of made) {
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.delete(sitePages).where(eq(sitePages.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(users).where(eq(users.id, f.ownerId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("행이 없으면 AUTO 다 — 옛 행에 키가 없어도 같다", async () => {
    const f = await make();
    expect(await getSiteColorScheme(f.businessId)).toBe("AUTO");
    expect((await loadPublicHome(f.businessId))!.colorScheme).toBe("AUTO");

    await db.insert(sitePages).values({ businessId: f.businessId, draftData: { sections: [] }, theme: { primaryColor: "#14a86b", fontScale: 1, radius: 12, containerWidth: 1080 }, isPublished: true });
    expect(await getSiteColorScheme(f.businessId), "colorScheme 키가 없는 옛 행").toBe("AUTO");
    expect((await loadPublicHome(f.businessId))!.colorScheme).toBe("AUTO");
  }, 30_000);

  it("밝기를 처음 고를 때 만들어지는 행은 공개 상태여야 한다", async () => {
    const f = await make();
    expect(await db.select().from(sitePages).where(eq(sitePages.businessId, f.businessId)), "빌더를 연 적이 없다").toEqual([]);

    await updateSiteColorScheme(f.businessId, "DARK", actor(f.ownerId), meta);

    const [row] = await db.select().from(sitePages).where(eq(sitePages.businessId, f.businessId));
    expect(row.isPublished, "컬럼 기본값(false)에 맡기면 밝기를 바꾼 순간 가게가 404 가 된다").toBe(true);
    expect(await loadPublicHome(f.businessId), "여전히 열려 있어야 한다").toBeTruthy();
    expect((await loadPublicHome(f.businessId))!.colorScheme).toBe("DARK");
    expect((await loadConsoleBusiness(f.businessId)).colorScheme, "콘솔도 같은 값을 본다").toBe("DARK");
  }, 30_000);

  it("이미 있는 행은 발행 상태도, theme 의 나머지 키도 건드리지 않는다", async () => {
    const f = await make();
    // 사업자가 명시적으로 내려 둔 홈. 밝기를 바꾼다고 다시 공개되면 안 된다
    await db.insert(sitePages).values({ businessId: f.businessId, draftData: { sections: [] }, theme: { primaryColor: "#ff0000", fontScale: 1.2, radius: 4, containerWidth: 960 }, isPublished: false });

    await updateSiteColorScheme(f.businessId, "LIGHT", actor(f.ownerId), meta);

    const [row] = await db.select().from(sitePages).where(eq(sitePages.businessId, f.businessId));
    expect(row.isPublished, "내려 둔 것은 내려둔 채로").toBe(false);
    expect(row.theme).toMatchObject({ primaryColor: "#ff0000", fontScale: 1.2, radius: 4, containerWidth: 960, colorScheme: "LIGHT" });
    expect(await loadPublicHome(f.businessId), "내려 둔 홈은 404 그대로").toBeNull();
  }, 30_000);

  it("같은 값으로 저장하면 아무것도 쓰지 않는다 — 감사 로그가 같은 값으로 채워지지 않게", async () => {
    const f = await make();
    expect((await updateSiteColorScheme(f.businessId, "AUTO", actor(f.ownerId), meta)).changed, "기본값과 같다").toBe(false);
    expect(await db.select().from(sitePages).where(eq(sitePages.businessId, f.businessId)), "행조차 만들지 않는다").toEqual([]);

    expect((await updateSiteColorScheme(f.businessId, "DARK", actor(f.ownerId), meta)).changed).toBe(true);
    expect((await updateSiteColorScheme(f.businessId, "DARK", actor(f.ownerId), meta)).changed).toBe(false);

    const logs = await db.select({ diff: auditLogs.diff }).from(auditLogs).where(and(eq(auditLogs.businessId, f.businessId), eq(auditLogs.action, "BUSINESS_UPDATE")));
    expect(logs).toHaveLength(1);
    expect(logs[0].diff).toEqual({ siteColorScheme: { from: "AUTO", to: "DARK" } });
  }, 30_000);
});
