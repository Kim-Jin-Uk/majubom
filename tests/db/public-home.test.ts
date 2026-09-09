import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businessSlugHistory, businesses, holidays, productResources, products, reservationLogs, reservations, resources, reviews, sitePages, users, workSchedules } from "@/db/schema";
import { createReservation } from "@/features/booking/create";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { loadPublicHome, resolveSlug } from "@/features/site/public-home";
import { addDays } from "@/features/schedule/resolve";
import { todayIn } from "@/lib/dates";
import { fakeBizRegNo } from "./_fixture";

/**
 * 공개 사업장 홈 (FR-SITE-010, #71). DB 가 있어야 볼 수 있는 것만.
 *
 * 이 파일의 중심은 **무엇이 404 인가**다. 승인 전·정지·차단·내려둔 홈·팔 것이 없는 가게가 전부 같은 답이어야
 * slug 를 훑어 사업장 목록을 만들 수 없다. 상태마다 다른 응답을 주는 순간 그 방어가 사라진다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

const TZ = "Asia/Seoul";
const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCHours(0, 0, 0, 0);
const at = (h: number) => new Date(START.getTime() + h * 3_600_000).toISOString();

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `shop-${tag}`,
      name: `봄 네일 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "nail",
      status: "APPROVED",
      timezone: TZ,
      phone: "02-123-4567",
      address: "서울 마포구 어딘가로 1",
      addressDetail: "2층",
      description: "작은 네일샵입니다.",
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "09:00", close: "18:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, autoConfirm: false },
    })
    .returning({ id: businesses.id, slug: businesses.slug });
  await db.insert(businessSlugHistory).values({ businessId: biz.id, slug: biz.slug });

  const [staff] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "디자이너 봄", capacity: 1 }).returning({ id: resources.id });
  // STAFF 는 근무 패턴이 있어야 예약을 받는다 (resolveWorkDay) — 리뷰를 달려면 예약이 있어야 한다
  await db.insert(workSchedules).values([0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId: staff.id, dayOfWeek, startTime: "09:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01" })));
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "젤네일", description: "손톱을 예쁘게", images: ["https://img.example/1.jpg", "https://img.example/2.jpg"], priceDisplay: "50,000원", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: staff.id });
  const [cust] = await db.insert(users).values({ email: `c-${tag}@test.local`, name: "김손님", provider: "KAKAO" }).returning({ id: users.id });

  return { businessId: biz.id, slug: biz.slug, productId: prd.id, resourceId: staff.id, customerId: cust.id };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

describe.skipIf(!enabled)("공개 사업장 홈 (FR-SITE-010)", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      await db.delete(reviews).where(eq(reviews.businessId, f.businessId));
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(holidays).where(eq(holidays.businessId, f.businessId));
      await db.delete(sitePages).where(eq(sitePages.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(users).where(eq(users.id, f.customerId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("승인된 가게는 빌더 없이도 열린다 — 시작 템플릿이 기본값이다", async () => {
    const f = await make();
    expect(await db.select().from(sitePages).where(eq(sitePages.businessId, f.businessId)), "빌더를 연 적이 없다").toEqual([]);
    const home = await loadPublicHome(f.businessId);
    expect(home, "site_pages 행이 없다고 404 면 아무도 공개될 수 없다").toBeTruthy();
    expect(home!.name).toContain("봄 네일");
    // DB 에는 `nail` 이 들어 있다 — 코드값이 화면과 <title> 에 그대로 나가면 안 된다
    expect(home!.category, "업종은 사람이 읽는 이름으로").toBe("네일 · 왁싱");
    expect(home!.products.map((p) => p.name)).toEqual(["젤네일"]);
    expect(home!.products[0].images).toHaveLength(2);
  }, 30_000);

  it("사업자가 홈을 내리면 닫힌다", async () => {
    const f = await make();
    await db.insert(sitePages).values({ businessId: f.businessId, draftData: { sections: [] }, theme: { primaryColor: "#14a86b", fontScale: 1, radius: 12, containerWidth: 1080 }, isPublished: false });
    expect(await loadPublicHome(f.businessId), "명시적으로 내린 것은 따른다").toBeNull();
    await db.update(sitePages).set({ isPublished: true }).where(eq(sitePages.businessId, f.businessId));
    expect(await loadPublicHome(f.businessId)).toBeTruthy();
  }, 30_000);

  it("승인 전·정지·차단은 전부 같은 404 다 — 상태가 새면 slug 를 훑어 목록을 만들 수 있다", async () => {
    const f = await make();
    for (const status of ["PENDING", "REJECTED", "SUSPENDED", "BLOCKED"] as const) {
      await db.update(businesses).set({ status }).where(eq(businesses.id, f.businessId));
      expect(await loadPublicHome(f.businessId), status).toBeNull();
    }
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));
    expect(await loadPublicHome(f.businessId)).toBeTruthy();
  }, 30_000);

  it("팔 것이 없거나 받을 사람이 없으면 열지 않는다", async () => {
    const f = await make();
    await db.update(products).set({ status: "HIDDEN" }).where(eq(products.id, f.productId));
    expect(await loadPublicHome(f.businessId), "공개 상품 0개").toBeNull();
    await db.update(products).set({ status: "ACTIVE" }).where(eq(products.id, f.productId));

    await db.update(resources).set({ isActive: false }).where(eq(resources.id, f.resourceId));
    expect(await loadPublicHome(f.businessId), "받을 자원 0개").toBeNull();
    await db.update(resources).set({ isActive: true }).where(eq(resources.id, f.resourceId));
    expect(await loadPublicHome(f.businessId)).toBeTruthy();
  }, 30_000);

  it("바뀐 예전 주소는 새 주소를 알려 준다 (301 의 근거)", async () => {
    const f = await make();
    expect(await resolveSlug(f.slug)).toEqual({ kind: "ok", businessId: f.businessId });

    const next = `${f.slug}-new`.slice(0, 30);
    await db.insert(businessSlugHistory).values({ businessId: f.businessId, slug: next });
    await db.update(businesses).set({ slug: next }).where(eq(businesses.id, f.businessId));

    expect(await resolveSlug(next)).toEqual({ kind: "ok", businessId: f.businessId });
    expect(await resolveSlug(f.slug), "저장해 둔 링크와 검색 결과가 죽으면 안 된다").toEqual({ kind: "moved", slug: next });
    expect(await resolveSlug(`nope-${randomUUID().slice(0, 6)}`)).toEqual({ kind: "none" });
  }, 30_000);

  it("휴무 안내는 사업장 전체 휴무만 — 담당자 개인 휴가는 손님이 알 일이 아니다", async () => {
    const f = await make();
    const today = todayIn(TZ);
    await db.insert(holidays).values([
      { businessId: f.businessId, resourceId: null, type: "ONCE", startDate: addDays(today, 3), isFullDay: true, memo: "정기 휴무" },
      { businessId: f.businessId, resourceId: f.resourceId, type: "ONCE", startDate: addDays(today, 4), isFullDay: true, memo: "개인 사정" },
    ]);
    const home = await loadPublicHome(f.businessId);
    expect(home!.closedDays.map((c) => c.date)).toEqual([addDays(today, 3)]);
    // 메모는 안 나간다 — 콘솔의 그 칸은 "직원 교육" 같은 내부 메모를 적으라고 안내한다
    expect(JSON.stringify(home!.closedDays), "내부 메모가 손님 화면으로 새면 안 된다").not.toContain("정기 휴무");
  }, 30_000);

  it("리뷰 요약은 평균·건수와 마스킹된 작성자다", async () => {
    const f = await make();
    const r = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, customerNote: null }, { uid: f.customerId });
    await db.update(reservations).set({ status: "COMPLETED" }).where(eq(reservations.id, r.id));
    await db.insert(reviews).values({ businessId: f.businessId, productId: f.productId, reservationId: r.id, customerId: f.customerId, rating: 4, content: "정성껏 해주셨어요 감사합니다" });

    const home = await loadPublicHome(f.businessId);
    expect(home!.reviews.count).toBe(1);
    expect(home!.reviews.average).toBe(4);
    expect(home!.reviews.recent[0].author, "실명이 그대로 나가면 저평점 고객에게 보복할 여지가 생긴다").toBe("김*님");
  }, 45_000);

  it("정보가 덜 찬 가게는 열지 않는다 — 콘솔은 '아직 공개 아님' 이라고 말하는데 홈만 열리면 안 된다", async () => {
    const f = await make();
    // 가입 직후의 임시 주소. 한 번 쓴 slug 는 영구 예약이라 이 상태로 공개되면 되물릴 수 없다
    const patches: Array<Partial<typeof businesses.$inferInsert>> = [{ slug: `b-${randomUUID().slice(0, 8)}` }, { phone: null }, { address: null }, { openingHours: [] }];
    for (const patch of patches) {
      const before = await db.select({ slug: businesses.slug, phone: businesses.phone, address: businesses.address, openingHours: businesses.openingHours }).from(businesses).where(eq(businesses.id, f.businessId));
      await db.update(businesses).set(patch).where(eq(businesses.id, f.businessId));
      expect(await loadPublicHome(f.businessId), JSON.stringify(patch)).toBeNull();
      await db.update(businesses).set(before[0]).where(eq(businesses.id, f.businessId));
    }
    expect(await loadPublicHome(f.businessId)).toBeTruthy();
  }, 45_000);

  it("같은 날 휴무 규칙이 겹쳐도 한 줄이다 — 종일이 부분을 덮는다", async () => {
    const f = await make();
    const today = todayIn(TZ);
    const day = addDays(today, 5);
    await db.insert(holidays).values([
      { businessId: f.businessId, resourceId: null, type: "ONCE", startDate: day, isFullDay: false, startTime: "12:00", endTime: "14:00" },
      { businessId: f.businessId, resourceId: null, type: "ONCE", startDate: day, isFullDay: true },
    ]);
    const home = await loadPublicHome(f.businessId);
    const hit = home!.closedDays.filter((c) => c.date === day);
    expect(hit, "두 줄로 나오면 화면에서 같은 날짜가 두 번 뜨고 React key 도 부딪힌다").toHaveLength(1);
    expect(hit[0].partial, "종일 휴무가 이긴다").toBeNull();
  }, 45_000);

  it("옮겨 간 곳이 닫혀 있으면 301 도 주지 않는다 — 없는 slug 와 구별되면 목록을 만들 수 있다", async () => {
    const f = await make();
    const next = `moved-${randomUUID().slice(0, 8)}`;
    await db.insert(businessSlugHistory).values({ businessId: f.businessId, slug: next });
    await db.update(businesses).set({ slug: next }).where(eq(businesses.id, f.businessId));

    // 열려 있는 동안은 옛 주소가 새 주소를 알려 준다
    expect(await resolveSlug(f.slug)).toEqual({ kind: "moved", slug: next });
    expect(await loadPublicHome(f.businessId), "지금은 열려 있다").toBeTruthy();

    // 차단되면 새 주소도 열리지 않는다 — 페이지는 이 조합에서 404 를 내야 한다(page.tsx resolve)
    await db.update(businesses).set({ status: "BLOCKED" }).where(eq(businesses.id, f.businessId));
    expect(await loadPublicHome(f.businessId)).toBeNull();
  }, 45_000);
});
