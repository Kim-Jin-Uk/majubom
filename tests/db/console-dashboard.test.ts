import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { businessMembers, businesses, productResources, products, reservationLogs, reservations, resources, users, workSchedules } from "@/db/schema";
import { getCalendar } from "@/features/booking/calendar";
import type { ConsoleActor } from "@/features/booking/console";
import { getDashboard, utilization } from "@/features/booking/dashboard";
import { loadOperatingContext } from "@/features/booking/operating-context";
import { createReservation } from "@/features/booking/create";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { todayIn } from "@/lib/dates";
import { addDays, dateRange, dowOf } from "@/features/schedule/resolve";

/**
 * 대시보드·캘린더 (FR-BOOK-080 #59·#60). DB 가 있어야 볼 수 있는 것만.
 *
 * 가동률이 이 파일의 중심이다 — 분모(운영 가능 시간)는 슬롯 계산과 **같은 함수**로 나와야 하고,
 * 분자는 확정·완료만, 운영시간 안으로 잘라서 세야 한다. 셋 중 하나만 틀려도 숫자는 그럴듯하게 나온다.
 */
const url = process.env.DATABASE_URL ?? "";
const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
const enabled = url.length > 0 && /test/i.test(dbName);

const TZ = "Asia/Seoul";
/** UTC 자정 = KST 09:00 = 개점 시각 */
const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCHours(0, 0, 0, 0);
const at = (h: number) => new Date(START.getTime() + h * 3_600_000).toISOString();
const kstDay = (iso: string) => todayIn(TZ, new Date(iso));

/**
 * 예약을 옮긴다. `occupy_range` 는 시작·종료와 버퍼에서 파생되는 컬럼이라
 * CHECK(reservations_occupy_derivation)가 [start − before, end + after) 를 요구한다 — 셋을 따로 쓰면 거부당한다.
 */
async function moveTo(id: string, startIso: string, minutes: number, opts: { before?: number; after?: number; status?: "REQUESTED" | "CONFIRMED" | "COMPLETED" } = {}) {
  const before = opts.before ?? 0;
  const after = opts.after ?? 0;
  const s = new Date(startIso);
  const e = new Date(s.getTime() + minutes * 60_000);
  const os = new Date(s.getTime() - before * 60_000);
  const oe = new Date(e.getTime() + after * 60_000);
  await db
    .update(reservations)
    .set({
      startAt: s,
      endAt: e,
      durationMin: minutes,
      bufferBeforeMin: before,
      bufferAfterMin: after,
      occupyRange: sql`tstzrange(${os.toISOString()}::timestamptz, ${oe.toISOString()}::timestamptz, '[)')`,
      ...(opts.status ? { status: opts.status } : {}),
    })
    .where(eq(reservations.id, id));
}

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `d-${tag}`,
      name: `대시보드 ${tag}`,
      bizRegNo: String(Date.now()).slice(-10),
      category: "etc",
      status: "APPROVED",
      timezone: TZ,
      // 매일 09:00~18:00 = 540분. 분모를 손으로 계산할 수 있게 브레이크 없이 둔다
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "09:00", close: "18:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 20, autoConfirm: false },
    })
    .returning({ id: businesses.id });

  const [ownerU] = await db.insert(users).values({ email: `o-${tag}@test.local`, name: "사장", provider: "LOCAL" }).returning({ id: users.id });
  const [mgrU] = await db.insert(users).values({ email: `m-${tag}@test.local`, name: "매니저", provider: "LOCAL" }).returning({ id: users.id });
  const [owner] = await db.insert(businessMembers).values({ userId: ownerU.id, businessId: biz.id, role: "OWNER", status: "ACTIVE" }).returning({ id: businessMembers.id });
  const [mgr] = await db.insert(businessMembers).values({ userId: mgrU.id, businessId: biz.id, role: "MANAGER", status: "ACTIVE" }).returning({ id: businessMembers.id });

  const [mine] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "내 자리", capacity: 1, memberId: mgr.id, sortOrder: 0 }).returning({ id: resources.id });
  const [theirs] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "동료 자리", capacity: 1, memberId: owner.id, sortOrder: 1 }).returning({ id: resources.id });
  await db.insert(workSchedules).values(
    [mine.id, theirs.id].flatMap((resourceId) => [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId, dayOfWeek, startTime: "09:00", endTime: "18:00", breaks: [], effectiveFrom: "2020-01-01" }))),
  );

  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "시술", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "OPTIONAL", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values([
    { productId: prd.id, resourceId: mine.id },
    { productId: prd.id, resourceId: theirs.id },
  ]);
  const [cust] = await db.insert(users).values({ email: `c-${tag}@test.local`, name: "김고객", provider: "KAKAO" }).returning({ id: users.id });

  return {
    businessId: biz.id,
    productId: prd.id,
    mine: mine.id,
    theirs: theirs.id,
    ownerActor: { uid: ownerU.id, role: "OWNER", memberId: owner.id, businessId: biz.id, canViewAll: false } satisfies ConsoleActor,
    mgrActor: { uid: mgrU.id, role: "MANAGER", memberId: mgr.id, businessId: biz.id, canViewAll: false } satisfies ConsoleActor,
    customerId: cust.id,
    userIds: [ownerU.id, mgrU.id, cust.id],
  };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

/** 하루 09:00~18:00 = 540분, 자원 2개 */
const DAY_MIN = 540;

describe.skipIf(!enabled)("대시보드 · 캘린더 (FR-BOOK-080)", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.update(reservations).set({ replacesReservationId: null }).where(eq(reservations.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.id, f.productId));
      // 개별 id 가 아니라 사업장 전체로 지운다 — 테스트가 자원을 더 만들면 FK 때문에 businesses 삭제가 터지고,
      // 그 순간 루프가 끊겨 뒤 픽스처가 통째로 남는다
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessMembers).where(eq(businessMembers.businessId, f.businessId));
      await db.delete(users).where(inArray(users.id, f.userIds));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("가동률 분모는 슬롯 계산과 같은 운영시간이다 — 하루 09:00~18:00 × 자원 2", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const ctx = await loadOperatingContext(f.businessId, day, day);
    const u = await utilization(f.businessId, day, day, ctx, null);
    expect(u.openMin, "540분 × 2자원").toBe(DAY_MIN * 2);
    expect(u.busyMin).toBe(0);
    expect(u.rate).toBe(0);
  }, 30_000);

  it("확정·완료만 센다 — 대기·취소·노쇼는 재고를 쓰지 않았다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const ctx = await loadOperatingContext(f.businessId, day, day);

    const a = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    // 생성 직후는 REQUESTED — 아직 세지 않는다
    expect((await utilization(f.businessId, day, day, ctx, null)).busyMin).toBe(0);

    await db.update(reservations).set({ status: "CONFIRMED" }).where(eq(reservations.id, a.id));
    expect((await utilization(f.businessId, day, day, ctx, null)).busyMin, "60분 예약 하나").toBe(60);

    await db.update(reservations).set({ status: "CANCELED_BY_USER" }).where(eq(reservations.id, a.id));
    expect((await utilization(f.businessId, day, day, ctx, null)).busyMin, "취소되면 재고가 돌아온다").toBe(0);

    await db.update(reservations).set({ status: "NO_SHOW" }).where(eq(reservations.id, a.id));
    expect((await utilization(f.businessId, day, day, ctx, null)).busyMin, "노쇼는 판 시간이 아니다").toBe(0);
  }, 45_000);

  it("운영시간 밖으로 나간 버퍼는 세지 않는다 — 100% 를 넘는 가동률이 나오면 지표가 아니라 잡음이다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const ctx = await loadOperatingContext(f.businessId, day, day);
    const a = await createReservation({ productId: f.productId, startAt: at(0), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    // 09:00~18:00 을 통째로 + 앞뒤 60분 버퍼 → 점유는 08:00~19:00 이지만 운영시간은 540분뿐이다
    await moveTo(a.id, at(0), DAY_MIN, { status: "CONFIRMED", before: 60, after: 60 });
    const u = await utilization(f.businessId, day, day, ctx, null);
    expect(u.busyMin, "버퍼가 개점 전·폐점 후로 나간 만큼은 빠진다").toBe(DAY_MIN);
    expect(u.rate!, "자원 둘 중 하나만 꽉 찼으니 절반").toBeCloseTo(0.5, 5);
  }, 45_000);

  it("매니저는 본인 담당 자원만으로 계산한다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const ctx = await loadOperatingContext(f.businessId, day, day);
    expect((await utilization(f.businessId, day, day, ctx, f.mine)).openMin, "자원 하나").toBe(DAY_MIN);

    const d = await getDashboard(f.mgrActor, day);
    expect(d.thisWeek.byResource.map((r) => r.resourceId), "동료 자원은 보이지 않는다").toEqual([f.mine]);
    expect(d.myResourceName).toBe("내 자리");
    expect(d.myWeek!.map((x) => x.date), "일요일부터 토요일까지").toEqual(dateRange(addDays(day, -dowOf(day)), addDays(addDays(day, -dowOf(day)), 6)));
    expect(d.myWeek!.every((x) => x.minutes === DAY_MIN)).toBe(true);
  }, 45_000);

  it("캘린더: 자정을 넘긴 예약은 시작 날짜 컬럼에 endMin > 1440 으로 이어진다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const a = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    // 23:00 시작 → 익일 01:00. 잘라내면 새벽 손님이 화면에서 사라진다
    await moveTo(a.id, `${day}T23:00:00+09:00`, 120, { status: "CONFIRMED" });
    const cal = await getCalendar(f.ownerActor, day, day);
    const col = cal.columns.find((c) => c.resourceId === f.mine)!;
    const b = col.days[0].blocks.find((x) => x.id === a.id);
    expect(b, "시작 날짜 컬럼에 있어야 한다").toBeTruthy();
    expect(b!.startMin).toBe(23 * 60);
    expect(b!.endMin, "익일 01:00 = 1500분").toBe(25 * 60);
    expect(cal.gridEndMin, "격자 끝은 정시로 올림한 1500").toBe(25 * 60);
  }, 45_000);

  it("캘린더: 취소·거절·만료는 격자에 그리지 않는다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const a = await createReservation({ productId: f.productId, startAt: at(2), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    expect((await getCalendar(f.ownerActor, day, day)).columns.flatMap((c) => c.days[0].blocks).map((b) => b.id)).toContain(a.id);
    await db.update(reservations).set({ status: "REJECTED" }).where(eq(reservations.id, a.id));
    expect((await getCalendar(f.ownerActor, day, day)).columns.flatMap((c) => c.days[0].blocks).map((b) => b.id)).not.toContain(a.id);
  }, 45_000);

  it("캘린더: 매니저 범위 밖 자원은 컬럼 자체가 없다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    await createReservation({ productId: f.productId, startAt: at(3), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });
    const cal = await getCalendar(f.mgrActor, day, day);
    expect(cal.columns.map((c) => c.resourceId)).toEqual([f.mine]);
    expect(cal.columns.flatMap((c) => c.days[0].blocks)).toEqual([]);
  }, 45_000);

  it("캘린더: 운영시간 구간을 함께 준다 — 화면이 다시 계산하지 않는다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const cal = await getCalendar(f.ownerActor, day, day);
    expect(cal.columns[0].days[0].open).toEqual([{ start: 9 * 60, end: 18 * 60 }]);
    expect(cal.gridStartMin).toBe(9 * 60);
  }, 30_000);

  it("담당 자원이 없는 매니저는 사업장 전체가 아니라 빈 값을 본다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const a = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await db.update(reservations).set({ status: "CONFIRMED" }).where(eq(reservations.id, a.id));
    // 담당이 안 붙은 매니저 — 술어가 빠지면 남의 예약·가동률이 통째로 보인다
    const orphan: ConsoleActor = { ...f.mgrActor, memberId: randomUUID() };

    const d = await getDashboard(orphan, day);
    expect(d.thisWeek.byResource, "볼 수 있는 자원이 없다").toEqual([]);
    expect(d.thisWeek.rate).toBeNull();
    expect(d.todayItems).toEqual([]);
    expect(d.pending).toBe(0);
    expect(d.myWeek, "담당이 없으면 내 근무도 없다").toBeNull();

    const cal = await getCalendar(orphan, day, day);
    expect(cal.columns).toEqual([]);
    expect(cal.gridEndMin, "빈 격자도 높이를 가진다 — 0 이면 화면이 0 으로 나눈다").toBeGreaterThan(cal.gridStartMin);
  }, 45_000);

  it("정원 N 자원은 좌석-분으로 센다 — 같은 시각 예약 넷이 네 시간이 되면 안 된다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    await db.update(resources).set({ capacity: 4 }).where(eq(resources.id, f.mine));
    await db.update(products).set({ capacityPerSlot: 4, maxPartySize: 4 }).where(eq(products.id, f.productId));
    // 같은 시각에 1인 + 2인. 좌석을 안 세면 둘 다 60분으로 잡혀 120 이 나온다
    const one = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    const two = await createReservation({ productId: f.productId, startAt: at(1), partySize: 2, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await db.update(reservations).set({ status: "CONFIRMED" }).where(inArray(reservations.id, [one.id, two.id]));

    const ctx = await loadOperatingContext(f.businessId, day, day);
    const u = await utilization(f.businessId, day, day, ctx, f.mine);
    expect(u.openMin, "540분 × 4좌석 = 재고는 좌석-분이다").toBe(DAY_MIN * 4);
    expect(u.busyMin, "(1좌석 + 2좌석) × 60분 = 180 좌석-분").toBe(180);
    expect(u.rate!, "180 / 2160").toBeCloseTo(180 / (DAY_MIN * 4), 6);

    // 정원 1 은 팀 단위라 인원과 무관하게 1좌석 (가정 A1)
    await db.update(resources).set({ capacity: 1 }).where(eq(resources.id, f.mine));
    const solo = await utilization(f.businessId, day, day, await loadOperatingContext(f.businessId, day, day), f.mine);
    expect(solo.openMin, "정원 1 이면 좌석-분 = 분").toBe(DAY_MIN);
  }, 60_000);

  it("주 캘린더: 7일치 컬럼을 주고 예약을 제 날짜에 놓는다", async () => {
    const f = await make();
    const from = kstDay(at(0));
    const to = addDays(from, 6);
    const a = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await moveTo(a.id, `${addDays(from, 3)}T14:00:00+09:00`, 60, { status: "CONFIRMED" });

    const cal = await getCalendar(f.ownerActor, from, to);
    expect(cal.dates).toHaveLength(7);
    for (const c of cal.columns) expect(c.days.map((d) => d.date), "컬럼마다 7일이 다 있어야 di 인덱스가 어긋나지 않는다").toEqual(cal.dates);
    const placed = cal.columns.flatMap((c) => c.days.map((d) => ({ date: d.date, ids: d.blocks.map((b) => b.id) })));
    expect(placed.filter((x) => x.ids.includes(a.id)).map((x) => x.date), "한 컬럼에만").toEqual([addDays(from, 3)]);
  }, 60_000);

  it("지난주 가동률도 같은 잣대로 계산한다 — 비교값이 0 이면 증감이 거짓말이 된다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    const weekStart = addDays(day, -dowOf(day));
    const a = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    // 지난주 같은 요일 14:00 으로 옮긴다
    await moveTo(a.id, `${addDays(weekStart, -4)}T14:00:00+09:00`, 60, { status: "COMPLETED" });

    const d = await getDashboard(f.ownerActor, day);
    expect(d.lastWeekRate, "지난주에도 운영시간이 있었으므로 null 이 아니다").not.toBeNull();
    expect(d.lastWeekRate!, "540분 × 2자원 중 60분").toBeCloseTo(60 / (DAY_MIN * 2 * 7), 6);
    expect(d.thisWeek.busyMin, "이번 주에는 없다").toBe(0);
  }, 60_000);

  /**
   * 심야 영업(20:00~02:00). 영업일이 자정을 넘기므로 01:00 예약은 **달력상 다음 날**이지만 영업일은 전날이다.
   * 달력 날짜로 가르면 그 예약이 다음 컬럼의 격자(20:00~) 위로 튀어나가 화면에서 사라지고,
   * 조회 상한을 `to` 24:00 으로 두면 가동률 분모에는 있는데 분자에는 없어서 매주 낮게 나온다.
   * 근무 패턴은 DB CHECK(start_time < end_time)가 자정 넘김을 막으므로(LATER.md L-13) SPACE 자원으로 본다.
   */
  it("심야 영업: 자정 넘긴 시각의 예약도 그 영업일 것으로 세고 그린다", async () => {
    const f = await make();
    await db.update(businesses).set({ openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "20:00", close: "02:00" })) }).where(eq(businesses.id, f.businessId));
    const [room] = await db.insert(resources).values({ businessId: f.businessId, type: "SPACE", name: "심야룸", capacity: 1, sortOrder: 5 }).returning({ id: resources.id });
    await db.insert(productResources).values({ productId: f.productId, resourceId: room.id });

    const day = kstDay(at(0));
    // 20:00 은 개점 시각이라 생성이 통과한다. 그다음 익일 01:00~02:00 으로 옮긴다 — 영업일로는 `day` 다
    const a = await createReservation({ productId: f.productId, startAt: at(11), partySize: 1, resourceId: room.id, customerNote: null }, { uid: f.customerId });
    await moveTo(a.id, `${addDays(day, 1)}T01:00:00+09:00`, 60, { status: "CONFIRMED" });

    const cal = await getCalendar(f.ownerActor, day, day);
    const col = cal.columns.find((c) => c.resourceId === room.id)!;
    expect(col.days[0].open, "20:00~익일 02:00 = 1200~1560분").toEqual([{ start: 20 * 60, end: 26 * 60 }]);
    const b = col.days[0].blocks.find((x) => x.id === a.id);
    expect(b, "달력 날짜로 가르면 여기서 사라진다").toBeTruthy();
    expect(b!.startMin, "영업일 기준 25시간 = 1500분").toBe(25 * 60);

    const ctx = await loadOperatingContext(f.businessId, day, day);
    const u = await utilization(f.businessId, day, day, ctx, room.id);
    expect(u.openMin, "20:00~02:00 = 360분").toBe(360);
    expect(u.busyMin, "조회 상한이 24:00 이면 여기서 0 이 된다").toBe(60);

    // 다음 날 하루 보기 — 달력 날짜로만 가르면 여기 01:00 자리에 유령 블록이 뜬다.
    // 그 시각은 다음 날 운영시간(20:00~) 밖이라 닫힌 구간에 떠 있고, 전날 컬럼에도 있으니 같은 예약이 두 번 보인다
    const nextCal = await getCalendar(f.ownerActor, addDays(day, 1), addDays(day, 1));
    expect(nextCal.columns.flatMap((c) => c.days.flatMap((d) => d.blocks)).map((b) => b.id), "전날 영업일 것이 다음 날 컬럼에 새면 안 된다").not.toContain(a.id);
  }, 60_000);

  it("좌석 수는 예약의 스냅샷(exclusive)이다 — 나중에 정원을 바꿔도 과거 집계가 흔들리지 않는다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    await db.update(resources).set({ capacity: 4 }).where(eq(resources.id, f.mine));
    await db.update(products).set({ capacityPerSlot: 4, maxPartySize: 4 }).where(eq(products.id, f.productId));
    const two = await createReservation({ productId: f.productId, startAt: at(1), partySize: 2, resourceId: f.mine, customerNote: null }, { uid: f.customerId });
    await db.update(reservations).set({ status: "CONFIRMED" }).where(eq(reservations.id, two.id));

    const before = await utilization(f.businessId, day, day, await loadOperatingContext(f.businessId, day, day), f.mine);
    expect(before.busyMin, "2좌석 × 60분").toBe(120);

    // 사업자가 정원을 4 → 1 로 줄인다. 예약은 그대로 남는다(exclusive=false 스냅샷)
    await db.update(resources).set({ capacity: 1 }).where(eq(resources.id, f.mine));
    const after = await utilization(f.businessId, day, day, await loadOperatingContext(f.businessId, day, day), f.mine);
    expect(after.busyMin, "지금 정원으로 다시 판정하면 60 으로 줄어든다 — 지난 기록이 설정 변경으로 바뀌면 안 된다").toBe(120);
    expect(after.openMin, "가진 재고는 지금 정원 기준").toBe(DAY_MIN);
  }, 60_000);

  it("사장님도 본인이 STAFF 자원이면 캘린더에서 자기 담당을 안다", async () => {
    const f = await make();
    const day = kstDay(at(0));
    // 픽스처의 `theirs` 는 memberId = owner — 사장님이 함께 시술하는 매장이다
    const own = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.theirs, customerNote: null }, { uid: f.customerId });
    const other = await createReservation({ productId: f.productId, startAt: at(1), partySize: 1, resourceId: f.mine, customerNote: null }, { uid: f.customerId });

    const cal = await getCalendar(f.ownerActor, day, day);
    const find = (id: string) => cal.columns.flatMap((c) => c.days.flatMap((d) => d.blocks)).find((b) => b.id === id)!;
    expect(find(own.id).mine, "scope() 가 OWNER 에게 mineId 를 안 주면 여기서 false 가 된다").toBe(true);
    expect(find(other.id).mine).toBe(false);

    const d = await getDashboard(f.ownerActor, day);
    expect(d.myResourceName, "대시보드의 내 근무도 같은 판정이어야 한다").toBe("동료 자리");
  }, 60_000);
});
