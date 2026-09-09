import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businesses, productResources, products, reservationLogs, reservations, resources, users } from "@/db/schema";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { createReservation } from "@/features/booking/create";
import { HttpError } from "@/features/auth/errors";

/**
 * FR-BOOK-020 동시성 회귀 — 명세가 요구하는 두 케이스 (에픽 #7 의 "부하 테스트 필수").
 *   ① 정원 1 슬롯에 동시 요청 N → 정확히 1건
 *   ② 정원 15 회차에 동시 요청 N → 정확히 15건
 * 앞의 것은 DB 배타 제약(`no_overlap`), 뒤의 것은 `pg_advisory_xact_lock` + 재계산이 지킨다. 둘 중 하나라도 빠지면 여기서 깨진다.
 *
 * **실제 Postgres 가 필요하다.** CI 는 임시 컨테이너(majubom_test)를 띄우고 마이그레이션을 적용한 뒤 돌린다.
 * 로컬에서는 DB 이름에 test 가 든 DATABASE_URL 을 준 경우에만 돈다 — 실수로 운영 DB 에 예약을 만들지 않기 위해서다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

const CONCURRENCY = 20;
const START = new Date(Date.now() + 7 * 86_400_000);
START.setUTCMinutes(0, 0, 0);

type Fixture = { businessId: string; productId: string; resourceIds: string[]; customerIds: string[] };

async function makeFixture(opts: { capacity: number; capacityPerSlot: number; maxPartySize: number; resourceCount?: number }): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `t-${tag}`,
      name: `동시성 ${tag}`,
      bizRegNo: String(Date.now()).slice(-10),
      category: "etc",
      status: "APPROVED",
      // 매일 00:00~00:00 = 24시간 영업 — 테스트가 요일·영업시간에 흔들리지 않게
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 20 },
    })
    .returning({ id: businesses.id });
  const resourceIds: string[] = [];
  for (let i = 0; i < (opts.resourceCount ?? 1); i++) {
    const [r] = await db.insert(resources).values({ businessId: biz.id, type: "SHARED", name: `자원${i}`, capacity: opts.capacity, sortOrder: i }).returning({ id: resources.id });
    resourceIds.push(r.id);
  }
  const [prd] = await db
    .insert(products)
    .values({
      businessId: biz.id,
      name: "상품",
      startMode: "FREE",
      slotIntervalMin: 60,
      durationMin: 60,
      capacityPerSlot: opts.capacityPerSlot,
      maxPartySize: opts.maxPartySize,
      resourceSelectMode: "NONE",
      status: "ACTIVE",
    })
    .returning({ id: products.id });
  await db.insert(productResources).values(resourceIds.map((resourceId) => ({ productId: prd.id, resourceId })));
  const customerIds: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const [u] = await db.insert(users).values({ email: `c${i}-${tag}@test.local`, name: `고객${i}`, provider: "LOCAL" }).returning({ id: users.id });
    customerIds.push(u.id);
  }
  return { businessId: biz.id, productId: prd.id, resourceIds, customerIds };
}

async function cleanup(f: Fixture) {
  const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
  if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
  await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
  await db.delete(productResources).where(eq(productResources.productId, f.productId));
  await db.delete(products).where(eq(products.id, f.productId));
  await db.delete(resources).where(inArray(resources.id, f.resourceIds));
  await db.delete(users).where(inArray(users.id, f.customerIds));
  await db.delete(businesses).where(eq(businesses.id, f.businessId));
}

/** 같은 시각에 동시에 던지고, 성공 수와 그 밖의 오류를 돌려준다 */
async function stampede(f: Fixture, partySize: number) {
  const startAt = START.toISOString();
  const results = await Promise.all(
    f.customerIds.map(async (uid) => {
      try {
        await createReservation({ productId: f.productId, startAt, partySize, customerNote: null }, { uid });
        return "ok" as const;
      } catch (e) {
        if (e instanceof HttpError) return e.code;
        throw e;
      }
    }),
  );
  const ok = results.filter((r) => r === "ok").length;
  const other = [...new Set(results.filter((r) => r !== "ok" && r !== "SLOT_TAKEN"))];
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reservations)
    .where(and(eq(reservations.businessId, f.businessId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"])));
  return { ok, other, stored: n };
}

describe.skipIf(!enabled)("FR-BOOK-020 동시성", () => {
  const fixtures: Fixture[] = [];
  beforeAll(() => {
    expect(enabled, "DATABASE_URL 이 test DB 를 가리켜야 한다").toBe(true);
  });
  afterAll(async () => {
    for (const f of fixtures) await cleanup(f);
    await pool.end();
  });

  it(`정원 1 슬롯에 ${CONCURRENCY} 동시 요청 → 정확히 1건 (배타 제약 no_overlap)`, async () => {
    const f = await makeFixture({ capacity: 1, capacityPerSlot: 1, maxPartySize: 1 });
    fixtures.push(f);
    const r = await stampede(f, 1);
    expect(r.other, "SLOT_TAKEN 아닌 오류가 있으면 안 된다").toEqual([]);
    expect(r.ok).toBe(1);
    expect(r.stored).toBe(1);
  }, 60_000);

  it(`정원 15 회차에 ${CONCURRENCY} 동시 요청 → 정확히 15건 (advisory lock + 재계산)`, async () => {
    const f = await makeFixture({ capacity: 15, capacityPerSlot: 15, maxPartySize: 1 });
    fixtures.push(f);
    const r = await stampede(f, 1);
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(15);
    expect(r.stored).toBe(15);
  }, 60_000);

  it(`정원 15 에 2명씩 ${CONCURRENCY} 동시 요청 → 정확히 7건 (Σ partySize ≤ 정원)`, async () => {
    const f = await makeFixture({ capacity: 15, capacityPerSlot: 15, maxPartySize: 4 });
    fixtures.push(f);
    const r = await stampede(f, 2);
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(7); // 7×2 = 14, 한 자리 남지만 2명은 못 들어간다
    expect(r.stored).toBe(7);
  }, 60_000);

  it(`정원 1 자원 3개에 ${CONCURRENCY} 동시 요청 → 정확히 3건 (자원 후보 루프)`, async () => {
    const f = await makeFixture({ capacity: 1, capacityPerSlot: 1, maxPartySize: 1, resourceCount: 3 });
    fixtures.push(f);
    const r = await stampede(f, 1);
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(3);
    // 자원마다 한 건씩 — 한 자원에 몰리지 않는다
    expect(new Set((await db.select({ id: reservations.resourceId }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((x) => x.id)).size).toBe(3);
  }, 60_000);
});
