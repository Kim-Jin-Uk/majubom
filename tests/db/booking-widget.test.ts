import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businessSlugHistory, businesses, productResources, products, resources, sitePages, workSchedules } from "@/db/schema";
import { loadBookingWidget } from "@/features/booking/widget/data";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { loadPublicHome } from "@/features/site/public-home";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 예약 위젯의 읽기 계층 (#11). 여기서 지키는 것은 둘이다.
 *
 * 1. **홈이 안 열리면 위젯도 안 열린다.** 위젯만 열리면 정지된 가게가 예약을 받는다.
 * 2. **홈에 걸린 예약 링크는 전부 살아 있다.** 홈의 `bookable` 과 위젯의 상품 목록이 어긋나면
 *    손님이 멀쩡해 보이는 카드를 눌러 404 에 도착한다.
 */
const TZ = "Asia/Seoul";

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `bw-${tag}`,
      name: `위젯 ${tag}`,
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
  const [staff] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "디자이너 봄", capacity: 1 }).returning({ id: resources.id });
  await db.insert(workSchedules).values([0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId: staff.id, dayOfWeek, startTime: "09:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01" })));
  const mk = async (name: string, over: Partial<typeof products.$inferInsert> = {}) => {
    const [p] = await db
      .insert(products)
      .values({ businessId: biz.id, name, images: [], startMode: "FREE", slotIntervalMin: 30, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "OPTIONAL", status: "ACTIVE", ...over })
      .returning({ id: products.id });
    return p.id;
  };
  const linked = await mk("젤네일");
  await db.insert(productResources).values({ productId: linked, resourceId: staff.id });
  return { businessId: biz.id, staffId: staff.id, linked, mk };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

describe.skipIf(!dbTestEnabled())("예약 위젯 읽기 계층 (#11)", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: products.id }).from(products).where(eq(products.businessId, f.businessId))).map((p) => p.id);
      for (const id of ids) await db.delete(productResources).where(eq(productResources.productId, id));
      await db.delete(sitePages).where(eq(sitePages.businessId, f.businessId));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("홈이 닫히면 위젯도 닫힌다 — 위젯만 열리면 정지된 가게가 예약을 받는다", async () => {
    const f = await make();
    expect(await loadBookingWidget(f.businessId)).toBeTruthy();
    for (const status of ["PENDING", "SUSPENDED", "BLOCKED"] as const) {
      await db.update(businesses).set({ status }).where(eq(businesses.id, f.businessId));
      expect(await loadPublicHome(f.businessId), status).toBeNull();
      expect(await loadBookingWidget(f.businessId), status).toBeNull();
    }
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));

    await db.insert(sitePages).values({ businessId: f.businessId, draftData: { sections: [] }, theme: { primaryColor: "#14a86b", fontScale: 1, radius: 12, containerWidth: 1080 }, isPublished: false });
    expect(await loadBookingWidget(f.businessId), "사업자가 내린 홈").toBeNull();
  }, 30_000);

  it("받을 사람이 없는 상품은 목록에 없고, 홈도 그 카드에 링크를 걸지 않는다", async () => {
    const f = await make();
    const orphan = await f.mk("연결 안 된 상품");

    const home = await loadPublicHome(f.businessId);
    const widget = await loadBookingWidget(f.businessId);
    expect(home!.products.map((p) => p.id).sort(), "메뉴판에는 둘 다 보인다").toEqual([f.linked, orphan].sort());
    expect(widget!.products.map((p) => p.id), "예약할 수 있는 것은 하나").toEqual([f.linked]);
    // 홈의 링크 판정과 위젯의 목록이 어긋나면 손님이 404 에 도착한다
    expect(home!.products.filter((p) => p.bookable).map((p) => p.id)).toEqual(widget!.products.map((p) => p.id));
  }, 30_000);

  it("자원이 비활성이면 예약할 수 없다 — 연결만 남아 있는 것은 받을 사람이 있는 게 아니다", async () => {
    const f = await make();
    await db.update(resources).set({ isActive: false }).where(eq(resources.id, f.staffId));
    const home = await loadPublicHome(f.businessId);
    expect(home, "활성 자원 0 이면 홈부터 닫힌다").toBeNull();
    expect(await loadBookingWidget(f.businessId)).toBeNull();
  }, 30_000);

  it("예약할 수 있는 상품이 하나도 없으면 위젯이 열리지 않는다", async () => {
    const f = await make();
    await db.delete(productResources).where(eq(productResources.productId, f.linked));
    expect(await loadPublicHome(f.businessId), "홈은 열려 있다 — 자원은 있고 연결만 없다").toBeTruthy();
    expect(await loadBookingWidget(f.businessId), "예약할 것이 없다").toBeNull();
  }, 30_000);

  it("AUTO 상품은 자원 목록을 내보내지 않는다 — 배정은 서버가 한다 (FR-PRD-010)", async () => {
    const f = await make();
    const auto = await f.mk("자동 배정", { resourceSelectMode: "AUTO" });
    await db.insert(productResources).values({ productId: auto, resourceId: f.staffId });
    const widget = await loadBookingWidget(f.businessId);
    const row = widget!.products.find((p) => p.id === auto)!;
    expect(row, "연결이 있으니 예약은 된다").toBeTruthy();
    expect(row.resources, "담당자 이름이 새어 나가면 안 된다").toEqual([]);
    expect(widget!.products.find((p) => p.id === f.linked)!.resources.map((r) => r.name)).toEqual(["디자이너 봄"]);
  }, 30_000);

  it("유형 판정은 저장값이 아니라 세 스위치에서 나온다", async () => {
    const f = await make();
    const space = await f.mk("스터디룸", { durationOptions: [60, 120, 240], maxPartySize: 4, resourceSelectMode: "REQUIRED" });
    const klass = await f.mk("하타요가", { startMode: "FIXED", slotIntervalMin: null, fixedStartTimes: [{ dow: 1, times: ["20:00"] }], resourceSelectMode: "NONE" });
    for (const id of [space, klass]) await db.insert(productResources).values({ productId: id, resourceId: f.staffId });
    const widget = await loadBookingWidget(f.businessId);
    const by = new Map(widget!.products.map((p) => [p.id, p.preset]));
    expect(by.get(f.linked)).toBe("staff");
    expect(by.get(space)).toBe("space");
    expect(by.get(klass)).toBe("class");
  }, 30_000);
});
