import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessMembers, businesses, productResources, products, reservationLogs, reservations, resources, users, workSchedules } from "@/db/schema";
import { getReservation, listReservations, reassignReservation, reservationCounts, type ConsoleActor } from "@/features/booking/console";
import { createReservation, createWalkIn } from "@/features/booking/create";
import { transitionReservation } from "@/features/booking/transitions";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { todayIn } from "@/lib/dates";
import type { RequestMeta } from "@/lib/request-meta";

/**
 * FR-BOOK-080 예약 콘솔 — 스코프(#63)가 이 파일의 핵심이다.
 * 매니저가 남의 담당 예약을 목록에서 보지 못하고, id 를 직접 넣어도 **404**(403 이 아니라)를 받는지,
 * 다른 사업장 예약이 어떤 경로로도 새지 않는지 — 셋 다 DB 가 있어야 볼 수 있다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

const TZ = "Asia/Seoul";
/**
 * UTC 자정 = KST 09:00 으로 고정한다 — `at(h)` 를 h < 15 로만 쓰면 KST 로도 같은 날 안이라
 * `dayOf(at(h))` (UTC 날짜) 가 사업장 날짜와 같다. 픽스처는 24시간 영업이라 시각 자체에는 제약이 없다.
 */
const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCHours(0, 0, 0, 0);
const at = (h: number) => new Date(START.getTime() + h * 3_600_000).toISOString();

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `k-${tag}`,
      name: `콘솔 ${tag}`,
      bizRegNo: String(Date.now()).slice(-10),
      category: "etc",
      status: "APPROVED",
      timezone: TZ,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 10, autoConfirm: false },
    })
    .returning({ id: businesses.id });

  const [ownerU] = await db.insert(users).values({ email: `o-${tag}@test.local`, name: "사장", provider: "LOCAL" }).returning({ id: users.id });
  const [mgrU] = await db.insert(users).values({ email: `m-${tag}@test.local`, name: "매니저", provider: "LOCAL" }).returning({ id: users.id });
  const [owner] = await db.insert(businessMembers).values({ userId: ownerU.id, businessId: biz.id, role: "OWNER", status: "ACTIVE" }).returning({ id: businessMembers.id });
  const [mgr] = await db.insert(businessMembers).values({ userId: mgrU.id, businessId: biz.id, role: "MANAGER", status: "ACTIVE" }).returning({ id: businessMembers.id });

  // 담당이 붙은 자원 두 개 — 매니저는 자기 것만 봐야 한다
  const [mine] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "내 자리", capacity: 1, memberId: mgr.id, sortOrder: 0 }).returning({ id: resources.id });
  const [theirs] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "동료 자리", capacity: 1, memberId: owner.id, sortOrder: 1 }).returning({ id: resources.id });

  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "시술", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "OPTIONAL", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values([
    { productId: prd.id, resourceId: mine.id },
    { productId: prd.id, resourceId: theirs.id },
  ]);
  // 연결하지 않은 자원 — 담당 변경이 거절해야 한다
  const [loose] = await db.insert(resources).values({ businessId: biz.id, type: "SPACE", name: "창고", capacity: 1, sortOrder: 2 }).returning({ id: resources.id });

  // STAFF 자원은 근무 패턴이 있어야 예약을 받는다 (resolveWorkDay) — 없으면 슬롯이 하나도 나오지 않는다
  await db.insert(workSchedules).values(
    [mine.id, theirs.id].flatMap((resourceId) => [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId, dayOfWeek, startTime: "00:00", endTime: "23:59", breaks: [], effectiveFrom: "2020-01-01" }))),
  );

  const [cust] = await db.insert(users).values({ email: `c-${tag}@test.local`, name: "김고객", provider: "KAKAO" }).returning({ id: users.id });
  const [walkInU] = await db.insert(users).values({ email: `walkin+${biz.id}@internal`, name: "워크인", provider: "LOCAL" }).returning({ id: users.id });

  return {
    businessId: biz.id,
    productId: prd.id,
    mine: mine.id,
    theirs: theirs.id,
    loose: loose.id,
    ownerActor: { uid: ownerU.id, role: "OWNER", memberId: owner.id, businessId: biz.id, canViewAll: false } satisfies ConsoleActor,
    mgrActor: { uid: mgrU.id, role: "MANAGER", memberId: mgr.id, businessId: biz.id, canViewAll: false } satisfies ConsoleActor,
    customerId: cust.id,
    walkInId: walkInU.id,
    userIds: [ownerU.id, mgrU.id, cust.id, walkInU.id],
  };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
async function make() {
  const f = await fixture();
  made.push(f);
  return f;
}

/** 서버가 주는 벽시계 문자열(`…+09:00`)의 날짜 부분 */
const dayOf = (iso: string) => iso.slice(0, 10);
/** UTC 순간 → 사업장(KST) 날짜. `at()` 결과는 UTC 문자열이라 앞 10자를 그냥 자르면 UTC 15시 이후가 어긋난다 */
const kstDay = (iso: string) => todayIn(TZ, new Date(iso));

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** 예약을 다른 시각으로 옮긴다 — `occupy_range` 는 파생 컬럼이라 CHECK(reservations_occupy_derivation) 때문에 같이 써야 한다 */
async function moveTo(id: string, startAtIso: string, minutes: number) {
  const start = new Date(startAtIso);
  const end = new Date(start.getTime() + minutes * 60_000);
  await db
    .update(reservations)
    .set({ startAt: start, endAt: end, durationMin: minutes, occupyRange: sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')` })
    .where(eq(reservations.id, id));
}
const META: RequestMeta = { ip: null, userAgent: null };

describe.skipIf(!enabled)("예약 콘솔 (FR-BOOK-080)", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.update(reservations).set({ replacesReservationId: null }).where(eq(reservations.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.id, f.productId));
      await db.delete(resources).where(inArray(resources.id, [f.mine, f.theirs, f.loose]));
      await db.delete(businessMembers).where(eq(businessMembers.businessId, f.businessId));
      await db.delete(users).where(inArray(users.id, f.userIds));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("매니저는 본인 담당 자원의 예약만 본다 — 목록·상세·집계 모두", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const b = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });

    const range = { from: kstDay(at(-24)), to: kstDay(at(48)) };
    const asOwner = await listReservations(f.ownerActor, range, TZ, todayIn(TZ));
    expect(asOwner.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

    const asMgr = await listReservations(f.mgrActor, range, TZ, todayIn(TZ));
    expect(asMgr.items.map((x) => x.id)).toEqual([a.id]);
    expect(asMgr.items[0].mine).toBe(true);

    // 남의 담당 건은 id 를 알아도 404 — 403 은 "그 id 는 있다" 를 알려 준다
    await expect(getReservation(f.mgrActor, b.id, TZ)).rejects.toMatchObject({ status: 404 });
    await expect(getReservation(f.ownerActor, b.id, TZ)).resolves.toMatchObject({ id: b.id });

    // viewAllReservations 를 주면 전체가 보이고, 그래도 "내 건" 표시는 남는다
    const wide = await listReservations({ ...f.mgrActor, canViewAll: true }, range, TZ, todayIn(TZ));
    expect(wide.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(wide.items.find((x) => x.id === a.id)!.mine).toBe(true);
    expect(wide.items.find((x) => x.id === b.id)!.mine).toBe(false);

    // OWNER 에게 "내 담당" 강조는 없다 — 사장님은 전부 자기 것이라 표시가 뜻을 잃는다 (자원에 memberId 가 있어도 마찬가지)
    expect(asOwner.items.every((x) => x.mine === false)).toBe(true);
  }, 30_000);

  it("상태 전이도 범위 밖이면 404 — 409 로 현재 상태를 흘리지 않는다", async () => {
    const f = await make();
    const theirs = await createReservation({ productId: f.productId, startAt: at(15), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });
    const console_ = { kind: "CONSOLE" as const, uid: f.mgrActor.uid, role: "MANAGER" as const, memberId: f.mgrActor.memberId, businessId: f.businessId, canViewAll: false };

    // 표에 없는 전이를 먼저 만나면 409 + from 이 나가고, 그것만으로 동료 담당 예약의 존재와 상태를 알 수 있다
    await expect(transitionReservation(theirs.id, "COMPLETED", console_)).rejects.toMatchObject({ status: 404 });
    await expect(transitionReservation(theirs.id, "CONFIRMED", console_)).rejects.toMatchObject({ status: 404 });

    // viewAllReservations 는 **보이는 범위**만 넓힌다 — 처리까지 되면 FR-BOOK-030 이 무너진다
    await expect(transitionReservation(theirs.id, "CONFIRMED", { ...console_, canViewAll: true })).rejects.toMatchObject({ status: 403, code: "NOT_OWN_RESOURCE" });
  }, 30_000);

  it("다른 사업장 예약은 목록에도 없고 상세도 404", async () => {
    const f = await make();
    const other = await make();
    const mineRsv = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });

    const seen = await listReservations(other.ownerActor, { from: kstDay(at(-24)), to: kstDay(at(48)) }, TZ, todayIn(TZ));
    expect(seen.items.map((x) => x.id)).not.toContain(mineRsv.id);
    await expect(getReservation(other.ownerActor, mineRsv.id, TZ)).rejects.toMatchObject({ status: 404 });
    // 담당 변경도 같은 게이트를 거친다 — 남의 예약을 내 자원으로 끌어올 수 없다
    await expect(reassignReservation(other.ownerActor, mineRsv.id, other.mine, META)).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it("담당 자원이 없는 매니저는 빈 목록을 받는다 (아무 것도 안 걸린 술어로 전부 보이면 안 된다)", async () => {
    const f = await make();
    await createReservation({ productId: f.productId, startAt: at(2), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const orphan: ConsoleActor = { ...f.mgrActor, memberId: randomUUID() };
    const r = await listReservations(orphan, { from: kstDay(at(-24)), to: kstDay(at(48)) }, TZ, todayIn(TZ));
    expect(r.items).toEqual([]);
  }, 30_000);

  it("워크인은 받아 적은 이름으로 보이고 내부 계정의 이메일은 새지 않는다", async () => {
    const f = await make();
    const w = await createWalkIn({ productId: f.productId, startAt: at(3), partySize: 1, resourceId: f.mine, guestLabel: "박손님", internalMemo: "현금" }, { customerId: f.walkInId, businessId: f.businessId });
    const d = await getReservation(f.ownerActor, w.id, TZ);
    expect(d.customerName).toBe("박손님");
    expect(d.customerEmail).toBeNull();
    expect(d.customerProvider).toBeNull();
    expect(d.internalMemo).toBe("현금");
    const list = await listReservations(f.ownerActor, { from: kstDay(at(-24)), to: kstDay(at(48)), q: "박손님" }, TZ, todayIn(TZ));
    expect(list.items.map((x) => x.id)).toEqual([w.id]);
  }, 30_000);

  it("담당 변경: OWNER 만, 연결된 자원만, 빈 자리만", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(4), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });

    await expect(reassignReservation(f.mgrActor, a.id, f.theirs, META)).rejects.toMatchObject({ status: 403 });
    await expect(reassignReservation(f.ownerActor, a.id, f.loose, META)).rejects.toMatchObject({ status: 409, code: "RESOURCE_NOT_LINKED" });

    // 옮길 자리를 먼저 채워 두면 SLOT_TAKEN
    const blocker = await createReservation({ productId: f.productId, startAt: at(4), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });
    await expect(reassignReservation(f.ownerActor, a.id, f.theirs, META)).rejects.toMatchObject({ status: 409, code: "SLOT_TAKEN" });

    // 비우면 옮겨진다. 이력에 from/to 자원이 남는다
    await db.update(reservations).set({ status: "CANCELED_BY_BIZ" }).where(eq(reservations.id, blocker.id));
    await reassignReservation(f.ownerActor, a.id, f.theirs, META);
    const [moved] = await db.select({ resourceId: reservations.resourceId }).from(reservations).where(eq(reservations.id, a.id));
    expect(moved.resourceId).toBe(f.theirs);
    const logs = await db.select({ from: reservationLogs.fromResourceId, to: reservationLogs.toResourceId }).from(reservationLogs).where(eq(reservationLogs.reservationId, a.id));
    expect(logs.some((l) => l.from === f.mine && l.to === f.theirs)).toBe(true);
  }, 45_000);

  it("커서 페이지는 같은 시각 예약을 건너뛰지도 겹치지도 않는다", async () => {
    const f = await make();
    // 같은 시각 두 건 + 다른 시각 한 건. limit 1 이면 동시각 두 건이 페이지 경계에 걸린다 —
    // 커서가 startAt 만 비교하면 둘째가 통째로 사라진다
    const same = [
      (await createReservation({ productId: f.productId, startAt: at(10), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId })).id,
      (await createReservation({ productId: f.productId, startAt: at(10), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId })).id,
    ];
    const later = (await createReservation({ productId: f.productId, startAt: at(12), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId })).id;

    const range = { from: kstDay(at(-24)), to: kstDay(at(48)), limit: 1 };
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const page: Awaited<ReturnType<typeof listReservations>> = await listReservations(f.ownerActor, { ...range, ...(cursor ? { cursor } : {}) }, TZ, todayIn(TZ));
      seen.push(...page.items.map((x) => x.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort(), "동시각 두 건이 경계에 걸려도 한 번씩 나온다").toEqual([...same, later].sort());
  }, 45_000);

  it("요약: 오늘은 오늘 걸치는 건만, 승인 대기는 기간에 잘리지 않는다", async () => {
    const f = await make();
    const today = todayIn(TZ);
    const a = await createReservation({ productId: f.productId, startAt: at(5), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const b = await createReservation({ productId: f.productId, startAt: at(6), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });
    // 하나만 오늘로 당긴다 (생성은 최소 선행시간에 걸리므로 SQL 로 옮긴다)
    await moveTo(a.id, `${today}T12:00:00+09:00`, 60);

    const c = await reservationCounts(f.ownerActor, TZ, today);
    expect(c.today, "오늘 칸에는 오늘 걸치는 한 건만").toBe(1);
    expect(c.pending, "승인 대기는 기간과 무관하게 전부").toBe(2);

    // 만료 배치(C2)가 멈춰 지난 주 것이 남아 있는 상황 — 여기서 잘리면 미처리를 영영 못 본다
    await moveTo(b.id, new Date(Date.now() - 5 * 86_400_000).toISOString(), 60);
    const after = await reservationCounts(f.ownerActor, TZ, today);
    expect(after.pending, "지난 주의 미처리 건도 대기에 남는다").toBe(2);
    expect(after.today, "지난 주 건은 오늘 칸에 들어오지 않는다").toBe(1);
  }, 45_000);

  it("자정을 넘겨 끝나는 예약은 종료일 목록에도 나온다", async () => {
    const f = await make();
    const r = await createReservation({ productId: f.productId, startAt: at(6), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const startDay = kstDay(at(0));
    // 23:00 시작 → 익일 01:00 종료
    await moveTo(r.id, `${startDay}T23:00:00+09:00`, 120);
    const endDay = nextDay(startDay);

    const onEndDay = await listReservations(f.ownerActor, { from: endDay, to: endDay }, TZ, todayIn(TZ));
    expect(onEndDay.items.map((x) => x.id), "가게 안에 손님이 있는데 그날 목록에 없으면 처리할 수 없다").toContain(r.id);
    const onStartDay = await listReservations(f.ownerActor, { from: startDay, to: startDay }, TZ, todayIn(TZ));
    expect(onStartDay.items.map((x) => x.id)).toContain(r.id);

    // 정확히 자정에 끝나면 그날은 차지하지 않는다
    await moveTo(r.id, `${startDay}T23:00:00+09:00`, 60);
    const flush = await listReservations(f.ownerActor, { from: endDay, to: endDay }, TZ, todayIn(TZ));
    expect(flush.items.map((x) => x.id), "00:00 에 끝나는 예약은 다음 날을 차지하지 않는다").not.toContain(r.id);
  }, 45_000);

  it("상태·상품·경로·검색어 필터가 각자 다른 컬럼을 본다", async () => {
    const f = await make();
    const web = await createReservation({ productId: f.productId, startAt: at(6), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const walk = await createWalkIn({ productId: f.productId, startAt: at(7), partySize: 1, resourceId: f.mine, guestLabel: "이현장", internalMemo: null }, { customerId: f.walkInId, businessId: f.businessId });
    await db.update(reservations).set({ status: "COMPLETED" }).where(eq(reservations.id, walk.id));
    const range = { from: kstDay(at(-24)), to: kstDay(at(48)) };
    const ids = async (extra: Record<string, unknown>) => (await listReservations(f.ownerActor, { ...range, ...extra }, TZ, todayIn(TZ))).items.map((x) => x.id);

    expect(await ids({ status: ["COMPLETED"] })).toEqual([walk.id]);
    expect(await ids({ createdVia: "WALK_IN" })).toEqual([walk.id]);
    expect(await ids({ createdVia: "WEB" })).toEqual([web.id]);
    expect(await ids({ productId: f.productId })).toHaveLength(2);
    expect(await ids({ productId: randomUUID() })).toEqual([]);
    // 검색은 고객명·예약코드에도 걸린다 (워크인 이름은 앞 테스트)
    expect(await ids({ q: "김고객" })).toEqual([web.id]);
    expect(await ids({ q: web.code })).toEqual([web.id]);
    // 와일드카드는 글자로 다뤄야 한다 — 이스케이프를 빼면 여기서 두 건이 다 나온다
    expect(await ids({ q: "%" })).toEqual([]);
  }, 45_000);

  it("종료된 예약은 담당을 옮길 수 없다", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(8), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await db.update(reservations).set({ status: "COMPLETED" }).where(eq(reservations.id, a.id));
    // 배타 제약도 validateExisting 도 REQUESTED/CONFIRMED 만 본다 — 여기서 막지 않으면 끝난 예약의 담당자가 조용히 바뀐다
    await expect(reassignReservation(f.ownerActor, a.id, f.theirs, META)).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  }, 30_000);

  it("비활성 자원으로는 옮길 수 없다", async () => {
    const f = await make();
    const a = await createReservation({ productId: f.productId, startAt: at(9), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await db.update(resources).set({ isActive: false }).where(eq(resources.id, f.theirs));
    await expect(reassignReservation(f.ownerActor, a.id, f.theirs, META)).rejects.toMatchObject({ status: 409, code: "RESOURCE_INACTIVE" });
    await db.update(resources).set({ isActive: true }).where(eq(resources.id, f.theirs));
  }, 30_000);

});
