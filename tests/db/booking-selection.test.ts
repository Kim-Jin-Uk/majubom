import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { bookingSelections, businessSlugHistory, businesses, productResources, products, resources, workSchedules } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { createSelection, purgeExpiredSelections, loadSelection, SELECTIONS_PER_IP_PER_HOUR } from "@/features/booking/widget/selection";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 서버측 임시 선택 토큰 (#83). 로그인 왕복에서 고른 것을 살려 두기 위한 것이다.
 *
 * 여기서 지키는 것: **되살릴 수 없는 것은 조용히 없는 것으로 만든다.** 가게가 닫혔거나 상품이 내려갔는데
 * 되살려 주면, 손님은 확인 화면까지 갔다가 그다음에 막힌다 — 왜 막히는지 모른 채로.
 */
const TZ = "Asia/Seoul";
const meta = (ip: string | null) => ({ ip, userAgent: null });

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `sel-${tag}`,
      name: `선택 ${tag}`,
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
  const [staff] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "봄", capacity: 1 }).returning({ id: resources.id });
  const [other] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "여름", capacity: 1 }).returning({ id: resources.id });
  await db.insert(workSchedules).values([0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId: staff.id, dayOfWeek, startTime: "09:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01" })));
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "젤네일", images: [], startMode: "FREE", slotIntervalMin: 30, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "OPTIONAL", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: staff.id });
  return { businessId: biz.id, slug: biz.slug, productId: prd.id, staffId: staff.id, otherId: other.id };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

const input = (f: F, over: Record<string, unknown> = {}) => ({
  productId: f.productId,
  // 자정을 넘긴 영업일: 달력으로는 10-02 새벽인데 영업일은 10-01 이다
  startAt: "2026-10-02T01:00:00+09:00",
  businessDate: "2026-10-01",
  partySize: 1,
  durationMin: null,
  resourceId: f.staffId,
  customerNote: "주차 자리 있나요",
  ...over,
});

describe.skipIf(!dbTestEnabled())("선택 토큰 (#83)", () => {
  afterAll(async () => {
    for (const f of made) {
      await db.delete(bookingSelections).where(eq(bookingSelections.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("맡긴 것을 그대로 되살린다 — 영업일까지", async () => {
    const f = await make();
    const { id } = await createSelection(input(f), meta("203.0.113.5"));
    const got = await loadSelection(id);
    expect(got).toMatchObject({
      slug: f.slug,
      productId: f.productId,
      businessDate: "2026-10-01",
      partySize: 1,
      resourceId: f.staffId,
      customerNote: "주차 자리 있나요",
    });
    // 순간에서 영업일을 되짚으면 10-02 가 된다 — 그래서 따로 담는다
    expect(new Date(got!.startAt).toISOString()).toBe("2026-10-01T16:00:00.000Z");
  }, 30_000);

  it("이 상품에 연결되지 않은 자원은 버린다 — 남의 담당자를 실어 보낼 수 없다", async () => {
    const f = await make();
    const { id } = await createSelection(input(f, { resourceId: f.otherId }), meta("203.0.113.5"));
    expect((await loadSelection(id))!.resourceId, "연결 안 된 자원").toBeNull();
  }, 30_000);

  it("가게가 닫히면 되살릴 수 없다 — 확인 화면까지 갔다가 막히는 것보다 낫다", async () => {
    const f = await make();
    const { id } = await createSelection(input(f), meta("203.0.113.5"));
    await db.update(businesses).set({ status: "SUSPENDED" }).where(eq(businesses.id, f.businessId));
    expect(await loadSelection(id)).toBeNull();
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));
    expect(await loadSelection(id)).toBeTruthy();

    // 상품이 내려가도 같다
    await db.update(products).set({ status: "HIDDEN" }).where(eq(products.id, f.productId));
    expect(await loadSelection(id)).toBeNull();
    await db.update(products).set({ status: "ACTIVE" }).where(eq(products.id, f.productId));
  }, 30_000);

  it("닫힌 가게의 상품으로는 아예 만들 수 없다", async () => {
    const f = await make();
    await db.update(businesses).set({ status: "BLOCKED" }).where(eq(businesses.id, f.businessId));
    await expect(createSelection(input(f), meta("203.0.113.5"))).rejects.toMatchObject({ status: 404 });
    await db.update(businesses).set({ status: "APPROVED" }).where(eq(businesses.id, f.businessId));
  }, 30_000);

  it("사이에 담당자가 비활성이 되면 '상관없음' 으로 되돌린다", async () => {
    const f = await make();
    const { id } = await createSelection(input(f), meta("203.0.113.5"));
    // 자원이 하나뿐이라 비활성으로 만들면 가게가 통째로 닫힌다 — 둘째를 연결해 두고 첫째만 내린다
    await db.insert(productResources).values({ productId: f.productId, resourceId: f.otherId });
    await db.update(resources).set({ isActive: false }).where(eq(resources.id, f.staffId));
    expect((await loadSelection(id))!.resourceId, "없는 담당자를 고른 채로 서 있지 않게").toBeNull();
    await db.update(resources).set({ isActive: true }).where(eq(resources.id, f.staffId));
  }, 30_000);

  it("만료된 것은 없는 것이고, 정리 배치가 지운다", async () => {
    const f = await make();
    const { id } = await createSelection(input(f), meta("203.0.113.9"));
    await db.update(bookingSelections).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(bookingSelections.id, id));
    expect(await loadSelection(id), "만료 즉시 없는 것").toBeNull();
    expect(await purgeExpiredSelections()).toBeGreaterThan(0);
    expect(await db.select().from(bookingSelections).where(eq(bookingSelections.id, id))).toEqual([]);
  }, 30_000);

  it("IP 시간당 상한 — 로그인 없이 쓰는 유일한 쓰기 경로다", async () => {
    const f = await make();
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    // 상한 직전까지 한 번에 채운다 (하나씩 만들면 느리다)
    await db.insert(bookingSelections).values(
      Array.from({ length: SELECTIONS_PER_IP_PER_HOUR }, () => ({
        businessId: f.businessId,
        productId: f.productId,
        startAt: new Date(),
        businessDate: "2026-10-01",
        partySize: 1,
        expiresAt: sql`now() + interval '30 minutes'` as never,
        ip,
      })),
    );
    await expect(createSelection(input(f), meta(ip))).rejects.toBeInstanceOf(HttpError);
    // 다른 IP 는 멀쩡하다
    await expect(createSelection(input(f), meta("198.51.100.254"))).resolves.toBeTruthy();
  }, 45_000);
});
