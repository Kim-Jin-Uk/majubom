import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businessSlugHistory, businesses, productResources, products, resources, sitePages } from "@/db/schema";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { activeCategories, searchProducts } from "@/features/search/search";
import { loadPublicHome } from "@/features/site/public-home";
import { fakeBizRegNo } from "./_fixture";

/**
 * 공개 상품 검색 (메인 `/`).
 *
 * 이 파일의 중심은 **검색이 공개 홈보다 더 보여 주지 않는가**다. 공개 여부 판정이 두 곳에 있다 —
 * 공개 홈은 TS(`isInfoComplete`), 검색은 WHERE 절(`search/visibility.ts`). 둘이 어긋나면
 * 심사 중·정지·차단·내려둔 사업장의 상호와 상품명이 검색으로 새어 나간다.
 * 그래서 상태를 하나씩 바꿔 가며 **두 판정이 같은 답을 내는지** 본다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `find-${tag}`,
      name: `찾을가게 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "nail",
      status: "APPROVED",
      timezone: "Asia/Seoul",
      phone: "02-000-0000",
      address: "서울 마포구 검색로 7",
      openingHours: [1, 2, 3].map((dow) => ({ dow, open: "10:00", close: "19:00" })),
      policy: { ...DEFAULT_POLICY },
    })
    .returning({ id: businesses.id, slug: businesses.slug });
  await db.insert(businessSlugHistory).values({ businessId: biz.id, slug: biz.slug });
  const [room] = await db.insert(resources).values({ businessId: biz.id, type: "SPACE", name: "자리", capacity: 1 }).returning({ id: resources.id });
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: `젤네일 ${tag}`, startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: room.id });
  return { businessId: biz.id, slug: biz.slug, productId: prd.id, resourceId: room.id, tag };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

/** 그 사업장의 상품이 검색에 걸리는지 (다른 테스트가 넣은 데이터와 섞이지 않게 태그로 좁힌다) */
const findable = async (f: F) => (await searchProducts({ q: f.tag })).length > 0;

describe.skipIf(!enabled)("공개 상품 검색", () => {
  afterAll(async () => {
    for (const f of made) {
      await db.delete(sitePages).where(eq(sitePages.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("상품명·상호·주소로 찾는다", async () => {
    const f = await make();
    expect((await searchProducts({ q: f.tag })).length).toBe(1);
    expect((await searchProducts({ q: "검색로" })).some((h) => h.slug === f.slug)).toBe(true);
    expect((await searchProducts({ q: "찾을가게" })).some((h) => h.slug === f.slug)).toBe(true);
    expect(await searchProducts({ q: "없는말입니다zzz" })).toEqual([]);
  }, 30_000);

  it("업종으로 좁힌다", async () => {
    const f = await make();
    expect((await searchProducts({ q: f.tag, category: "nail" })).length).toBe(1);
    expect(await searchProducts({ q: f.tag, category: "hair" })).toEqual([]);
    // 없는 코드는 필터로 쓰지 않는다 — 오타 하나가 빈 화면이 되면 검색이 고장 난 것처럼 보인다
    expect((await searchProducts({ q: f.tag, category: "없는업종" })).length).toBe(1);
  }, 30_000);

  it("결과는 바로 예약으로 보낼 수 있는 것만 담는다", async () => {
    const f = await make();
    const [hit] = await searchProducts({ q: f.tag });
    expect(hit.slug).toBe(f.slug);
    expect(hit.productId).toBe(f.productId);
    expect(hit.categoryLabel).toBe("네일 · 왁싱");
    expect(hit.durationMin).toBe(60);
  }, 30_000);

  /**
   * 핵심. 검색과 공개 홈이 **같은 답**을 내야 한다 — 검색이 더 보여 주면 그게 곧 정보 유출이다.
   */
  it("검색이 공개 홈보다 더 보여 주지 않는다", async () => {
    const f = await make();
    const agree = async (label: string) => {
      const [inSearch, home] = await Promise.all([findable(f), loadPublicHome(f.businessId)]);
      expect(inSearch, `${label}: 검색=${inSearch} 공개홈=${home !== null}`).toBe(home !== null);
      return inSearch;
    };
    expect(await agree("기준")).toBe(true);

    for (const status of ["PENDING", "SUSPENDED", "BLOCKED", "REJECTED"] as const) {
      await db.update(businesses).set({ status }).where(eq(businesses.id, f.businessId));
      expect(await agree(`status=${status}`)).toBe(false);
    }
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));

    // 임시 slug — 승인을 받아도 공개되지 않는다 (`isInfoComplete`)
    await db.update(businesses).set({ slug: `b-${f.tag}` }).where(eq(businesses.id, f.businessId));
    expect(await agree("임시 slug")).toBe(false);
    await db.update(businesses).set({ slug: f.slug }).where(eq(businesses.id, f.businessId));

    // 정보 미완성 — 전화번호가 비면 공개 조건에 걸린다
    await db.update(businesses).set({ phone: "" }).where(eq(businesses.id, f.businessId));
    expect(await agree("전화번호 없음")).toBe(false);
    await db.update(businesses).set({ phone: "02-000-0000" }).where(eq(businesses.id, f.businessId));

    // 사업자가 홈을 내렸다
    await db.insert(sitePages).values({ businessId: f.businessId, draftData: { sections: [] }, theme: { primaryColor: "#14a86b", fontScale: 1, radius: 12, containerWidth: 1080 }, isPublished: false });
    expect(await agree("홈 내림")).toBe(false);
    await db.update(sitePages).set({ isPublished: true }).where(eq(sitePages.businessId, f.businessId));
    expect(await agree("홈 다시 공개")).toBe(true);

    // 상품이 ACTIVE 가 아니면 팔 것이 없다
    await db.update(products).set({ status: "HIDDEN" }).where(eq(products.id, f.productId));
    expect(await agree("상품 HIDDEN")).toBe(false);
    await db.update(products).set({ status: "ACTIVE" }).where(eq(products.id, f.productId));

    // 받을 자원이 없으면 눌러도 슬롯이 안 나온다
    await db.update(resources).set({ isActive: false }).where(eq(resources.id, f.resourceId));
    expect(await agree("자원 비활성")).toBe(false);
    await db.update(resources).set({ isActive: true }).where(eq(resources.id, f.resourceId));
    expect(await agree("복구")).toBe(true);
  }, 60_000);

  it("업종 칩은 공개 상품이 있는 업종만 낸다", async () => {
    const f = await make();
    const countOf = async () => (await activeCategories()).find((c) => c.code === "nail")?.count ?? 0;
    // 다른 테스트도 nail 을 쓸 수 있어 절대값을 못 쓴다 — 이 건이 빠질 때 **줄어드는지**를 본다
    const before = await countOf();
    expect(before).toBeGreaterThan(0);
    await db.update(businesses).set({ status: "SUSPENDED" }).where(eq(businesses.id, f.businessId));
    expect(await countOf()).toBe(before - 1);
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));
    expect(await countOf()).toBe(before);
  }, 30_000);
});
