import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businesses, productResources, products, reservationLogs, reservations, resources, users } from "@/db/schema";
import { createReservation, createWalkIn } from "@/features/booking/create";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { fakeBizRegNo } from "./_fixture";

/**
 * FR-BOOK-050 예약 변경 · FR-BOOK-070 워크인 — DB 가 있어야 볼 수 있는 것만.
 * 변경의 핵심은 "원 예약을 점유에서 빼고 같은 트랜잭션에서 취소" 다: 이게 없으면 같은 시각으로 옮기는 변경이 자기 자신과 충돌해 늘 409 가 되고,
 * 실패했을 때 원 예약이 사라진다. 둘 다 여기서 잡는다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCMinutes(0, 0, 0);
const at = (hoursFromStart: number) => new Date(START.getTime() + hoursFromStart * 3_600_000).toISOString();

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `c-${tag}`,
      name: `변경 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "etc",
      status: "APPROVED",
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 2 },
    })
    .returning({ id: businesses.id });
  const [room] = await db.insert(resources).values({ businessId: biz.id, type: "SPACE", name: "룸", capacity: 1 }).returning({ id: resources.id });
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "대여", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: room.id });
  const [cust] = await db.insert(users).values({ email: `u-${tag}@test.local`, name: "고객", provider: "LOCAL" }).returning({ id: users.id });
  const [walkIn] = await db.insert(users).values({ email: `walkin+${biz.id}@internal`, name: "워크인 고객", provider: "LOCAL" }).returning({ id: users.id });
  return { businessId: biz.id, productId: prd.id, resourceId: room.id, customerId: cust.id, walkInId: walkIn.id };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
async function make() {
  const f = await fixture();
  made.push(f);
  return f;
}

describe.skipIf(!enabled)("예약 변경 · 워크인", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.update(reservations).set({ replacesReservationId: null }).where(eq(reservations.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      // 사업장 단위로 지운다 — 테스트가 상품·자원을 더 만들 수 있고(한도는 상품마다 따로 센다),
      // 픽스처 id 만 지우면 남은 행이 아래 businesses 삭제를 FK 로 막는다
      const prodIds = (await db.select({ id: products.id }).from(products).where(eq(products.businessId, f.businessId))).map((r) => r.id);
      if (prodIds.length) await db.delete(productResources).where(inArray(productResources.productId, prodIds));
      await db.delete(products).where(eq(products.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(users).where(inArray(users.id, [f.customerId, f.walkInId]));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("정원 1 자원에서 같은 시각으로 옮기는 변경이 자기 자신과 충돌하지 않는다", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, customerNote: null }, { uid: f.customerId });
    // 같은 시각 그대로 다시 잡는다 — 원 예약이 점유에서 빠지지 않으면 여기서 409 가 난다
    const b = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, customerNote: null, replacesReservationId: a.id }, { uid: f.customerId });
    expect(b.id).not.toBe(a.id);
    const rows = await db.select({ id: reservations.id, status: reservations.status, replaces: reservations.replacesReservationId }).from(reservations).where(eq(reservations.businessId, f.businessId));
    expect(rows.find((r) => r.id === a.id)?.status).toBe("CANCELED_BY_USER");
    expect(rows.find((r) => r.id === b.id)?.replaces).toBe(a.id);
  }, 30_000);

  it("변경이 실패하면 통째로 되돌아간다 — 원 예약은 그대로 살아 있다", async () => {
    const f = await make();
    const mine = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, customerNote: null }, { uid: f.customerId });
    // 다른 손님이 옮겨 가려던 자리를 먼저 잡는다 (워크인으로 — 같은 자원, 정원 1)
    await createWalkIn({ productId: f.productId, resourceId: f.resourceId, startAt: at(2), partySize: 1, guestLabel: "선점" }, { customerId: f.walkInId, businessId: f.businessId });
    await expect(createReservation({ productId: f.productId, startAt: at(2), partySize: 1, customerNote: null, replacesReservationId: mine.id }, { uid: f.customerId })).rejects.toMatchObject({ status: 409 });
    const [row] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, mine.id));
    expect(row.status).toBe("CONFIRMED");
  }, 30_000);

  it("변경은 1인 동시 예약 한도를 넘기지 않는다 (원 예약이 먼저 빠진다)", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, customerNote: null }, { uid: f.customerId });
    await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, customerNote: null }, { uid: f.customerId });
    // 이 상품의 한도 2 를 채웠다 — 새 예약은 막히지만 변경은 된다
    await expect(createReservation({ productId: f.productId, startAt: at(3), partySize: 1, customerNote: null }, { uid: f.customerId })).rejects.toMatchObject({ status: 409 });
    const moved = await createReservation({ productId: f.productId, startAt: at(3), partySize: 1, customerNote: null, replacesReservationId: a.id }, { uid: f.customerId });
    expect(moved.status).toBe("CONFIRMED");
  }, 30_000);

  it("한도는 상품마다 따로 센다 — 한 상품을 채웠다고 다른 상품이 막히지 않는다", async () => {
    const f = await make();
    // 같은 사업장에 두 번째 상품을 둔다. 자원은 따로 준다 — 자원이 같으면 SLOT_TAKEN 과 구분이 안 된다
    const [room2] = await db.insert(resources).values({ businessId: f.businessId, type: "SPACE", name: "룸2", capacity: 1 }).returning({ id: resources.id });
    const [prd2] = await db
      .insert(products)
      .values({ businessId: f.businessId, name: "대여2", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
      .returning({ id: products.id });
    await db.insert(productResources).values({ productId: prd2.id, resourceId: room2.id });

    // 상품 1 의 한도(2)를 채운다
    await createReservation({ productId: f.productId, startAt: at(10), partySize: 1, customerNote: null }, { uid: f.customerId });
    await createReservation({ productId: f.productId, startAt: at(11), partySize: 1, customerNote: null }, { uid: f.customerId });
    await expect(createReservation({ productId: f.productId, startAt: at(12), partySize: 1, customerNote: null }, { uid: f.customerId })).rejects.toMatchObject({
      status: 409,
      code: "TOO_MANY_ACTIVE",
    });

    // 상품 2 는 열려 있어야 한다. 사업장 단위로 세면 여기서 409 가 난다
    const other = await createReservation({ productId: prd2.id, startAt: at(10), partySize: 1, customerNote: null }, { uid: f.customerId });
    expect(other.status).toBe("CONFIRMED");
    // 상품 2 도 자기 한도는 지킨다
    await createReservation({ productId: prd2.id, startAt: at(11), partySize: 1, customerNote: null }, { uid: f.customerId });
    await expect(createReservation({ productId: prd2.id, startAt: at(12), partySize: 1, customerNote: null }, { uid: f.customerId })).rejects.toMatchObject({
      status: 409,
      code: "TOO_MANY_ACTIVE",
    });
  }, 30_000);

  it("워크인은 선행시간을 우회하지만 자원 충돌은 그대로 막는다", async () => {
    const f = await make();
    // 지금부터 10분 뒤 — 정책 minLeadTimeMin 이 0 이 아니어도 워크인은 통과해야 한다
    await db.update(businesses).set({ policy: { ...DEFAULT_POLICY, minLeadTimeMin: 600, maxAdvanceDays: 365 } }).where(eq(businesses.id, f.businessId));
    const soon = new Date();
    soon.setUTCMinutes(0, 0, 0);
    soon.setUTCHours(soon.getUTCHours() + 1);
    const w = await createWalkIn({ productId: f.productId, resourceId: f.resourceId, startAt: soon.toISOString(), partySize: 1, guestLabel: "현장" }, { customerId: f.walkInId, businessId: f.businessId });
    expect(w.status).toBe("CONFIRMED");
    // 자리가 찼으면 409 SLOT_TAKEN 이어야 한다 — 400 LEAD_TIME 으로 나오면 충돌을 정책 오류로 감춘 것이다
    await expect(createWalkIn({ productId: f.productId, resourceId: f.resourceId, startAt: soon.toISOString(), partySize: 1, guestLabel: "겹침" }, { customerId: f.walkInId, businessId: f.businessId })).rejects.toMatchObject({ status: 409, code: "SLOT_TAKEN" });
    // 같은 시각을 고객이 잡으려 하면 선행시간에 막힌다 (정책은 고객에게만 적용)
    await expect(createReservation({ productId: f.productId, startAt: soon.toISOString(), partySize: 1, customerNote: null }, { uid: f.customerId })).rejects.toMatchObject({ status: 400 });
  }, 30_000);

  it("남의 예약·다른 상품·이미 시작한 예약은 대체할 수 없다", async () => {
    const f = await make();
    const other = await make();
    const mine = await createReservation({ productId: f.productId, startAt: at(5), partySize: 1, customerNote: null }, { uid: f.customerId });
    // 남의 예약 (다른 고객) — 존재를 알리지 않는다
    const theirs = await createReservation({ productId: other.productId, startAt: at(5), partySize: 1, customerNote: null }, { uid: other.customerId });
    await expect(createReservation({ productId: f.productId, startAt: at(6), partySize: 1, customerNote: null, replacesReservationId: theirs.id }, { uid: f.customerId })).rejects.toMatchObject({ status: 404 });
    // 다른 상품으로의 변경
    await expect(createReservation({ productId: other.productId, startAt: at(6), partySize: 1, customerNote: null, replacesReservationId: mine.id }, { uid: f.customerId })).rejects.toMatchObject({ status: 400, code: "PRODUCT_MISMATCH" });
    // 이미 시작한 예약
    const past = new Date(Date.now() - 3_600_000);
    const pastEnd = new Date(Date.now() - 1_800_000);
    await db
      .update(reservations)
      .set({ startAt: past, endAt: pastEnd, occupyRange: sql`tstzrange(${past.toISOString()}::timestamptz, ${pastEnd.toISOString()}::timestamptz, '[)')` })
      .where(eq(reservations.id, mine.id));
    await expect(createReservation({ productId: f.productId, startAt: at(6), partySize: 1, customerNote: null, replacesReservationId: mine.id }, { uid: f.customerId })).rejects.toMatchObject({ status: 400, code: "ALREADY_STARTED" });
  }, 30_000);

  it("워크인은 남의 사업장에 예약을 만들 수 없다 (콘솔이 자원만 보고 상품 소속을 놓쳤던 자리)", async () => {
    const mine = await make();
    const other = await make();
    // 내 사업장 콘솔에서 **남의 사업장 상품·자원** 으로 워크인을 시도한다.
    // 저장되는 businessId 는 상품에서 오므로, 여기서 막지 않으면 남의 사업장에 내 워크인 계정 명의로 예약이 생긴다
    await expect(
      createWalkIn({ productId: other.productId, resourceId: other.resourceId, startAt: at(20), partySize: 1, guestLabel: "침입" }, { customerId: mine.walkInId, businessId: mine.businessId }),
    ).rejects.toMatchObject({ status: 404 });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(reservations).where(eq(reservations.businessId, other.businessId));
    expect(n, "남의 사업장에 아무것도 남지 않아야 한다").toBe(0);
  }, 30_000);

  it("취소 마감을 지난 변경은 자동 승인이어도 REQUESTED 로 들어간다", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(10), partySize: 1, customerNote: null }, { uid: f.customerId });
    expect(a.status).toBe("CONFIRMED");
    // 시작을 3시간 뒤로 당긴다 — 취소 마감(24시간) 안이다
    const soon = new Date(Date.now() + 3 * 3_600_000);
    await db
      .update(reservations)
      .set({ startAt: soon, endAt: new Date(soon.getTime() + 3_600_000), occupyRange: sql`tstzrange(${soon.toISOString()}::timestamptz, ${new Date(soon.getTime() + 3_600_000).toISOString()}::timestamptz, '[)')` })
      .where(eq(reservations.id, a.id));
    const moved = await createReservation({ productId: f.productId, startAt: at(11), partySize: 1, customerNote: null, replacesReservationId: a.id }, { uid: f.customerId });
    expect(moved.status).toBe("REQUESTED");
  }, 30_000);
});
