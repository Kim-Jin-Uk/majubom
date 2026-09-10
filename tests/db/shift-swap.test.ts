import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessMembers, businesses, productResources, products, reservationLogs, reservations, resources, shiftSwapRequests, users, workExceptions, workSchedules } from "@/db/schema";
import { createReservation } from "@/features/booking/create";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { actOnSwap, createSwap, expireSwaps, listSwaps } from "@/features/schedule/swaps";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 근무 교대 (FR-SHIFT-010~030, #43~#46).
 *
 * 이 파일이 지키는 것은 리스크 R4 하나다: **근무표만 바뀌고 예약은 그대로 남는 상태를 만들지 않는다.**
 * 옮길 수 없는 예약이 하나라도 있으면 근무표도 상태도 그대로여야 하고, 요청 뒤 새 예약이 들어왔으면
 * 사람이 다시 보기 전에는 반영되지 않아야 한다.
 */
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => ({ id: null, delivered: false })) }));

const TZ = "Asia/Seoul";
/** UTC 자정 = KST 09:00 — `at(h)` 를 h < 15 로만 쓰면 KST 로도 같은 날이다 */
const D1 = new Date(Date.now() + 3 * 86_400_000);
D1.setUTCHours(0, 0, 0, 0);
const D2 = new Date(D1.getTime() + 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dow = (d: Date) => d.getUTCDay();
const at = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000).toISOString();

async function fixture(autoApprove = false) {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `sw-${tag}`,
      name: `교대 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "etc",
      status: "APPROVED",
      timezone: TZ,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dow: d, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 10, autoConfirm: true, shiftAutoApprove: autoApprove },
    })
    .returning({ id: businesses.id });

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ email: `${name}-${tag}@test.local`, name, provider: "LOCAL" }).returning({ id: users.id });
    const [m] = await db.insert(businessMembers).values({ userId: u.id, businessId: biz.id, role: "MANAGER", status: "ACTIVE" }).returning({ id: businessMembers.id });
    const [r] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: `${name} 자리`, capacity: 1, memberId: m.id }).returning({ id: resources.id });
    return { uid: u.id, memberId: m.id, resourceId: r.id, actor: { uid: u.id, role: "MANAGER" as const, memberId: m.id } };
  };
  const [ownerU] = await db.insert(users).values({ email: `own-${tag}@test.local`, name: "사장", provider: "LOCAL" }).returning({ id: users.id });
  const [ownerM] = await db.insert(businessMembers).values({ userId: ownerU.id, businessId: biz.id, role: "OWNER", status: "ACTIVE" }).returning({ id: businessMembers.id });
  const a = await mk("가");
  const b = await mk("나");

  // 가는 D1 요일에만, 나는 D2 요일에만 근무한다 — GIVE 의 "대상이 그날 이미 근무 중이면 불가" 를 통과하려면 필요하다.
  // 끝을 23:59 로 두는 것도 의도다: 자정(=1440)까지의 근무는 WorkException 에 적을 수 없어 교대가 막힌다
  await db.insert(workSchedules).values([
    { businessId: biz.id, resourceId: a.resourceId, dayOfWeek: dow(D1), startTime: "00:00", endTime: "23:59", breaks: [], effectiveFrom: "2020-01-01" },
    { businessId: biz.id, resourceId: b.resourceId, dayOfWeek: dow(D2), startTime: "00:00", endTime: "23:59", breaks: [], effectiveFrom: "2020-01-01" },
  ]);

  // 둘 다 맡을 수 있는 상품 / 가만 맡을 수 있는 상품
  const mkProduct = async (name: string, resourceIds: string[]) => {
    const [p] = await db
      .insert(products)
      .values({ businessId: biz.id, name, startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
      .returning({ id: products.id });
    await db.insert(productResources).values(resourceIds.map((resourceId) => ({ productId: p.id, resourceId })));
    return p.id;
  };
  const shared = await mkProduct("공용 시술", [a.resourceId, b.resourceId]);
  const onlyA = await mkProduct("가 전용", [a.resourceId]);

  const [cust] = await db.insert(users).values({ email: `c-${tag}@test.local`, name: "손님", provider: "LOCAL" }).returning({ id: users.id });

  return { businessId: biz.id, a, b, shared, onlyA, customerId: cust.id, ownerActor: { uid: ownerU.id, role: "OWNER" as const, memberId: ownerM.id }, userIds: [ownerU.id, a.uid, b.uid, cust.id], memberIds: [ownerM.id, a.memberId, b.memberId] };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async (autoApprove = false) => {
  const f = await fixture(autoApprove);
  made.push(f);
  return f;
};
const meta = { ip: null, userAgent: null };
const exceptionsOf = (f: F) => db.select().from(workExceptions).where(eq(workExceptions.businessId, f.businessId));

describe.skipIf(!dbTestEnabled())("근무 교대 (#43)", () => {
  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(shiftSwapRequests).where(eq(shiftSwapRequests.businessId, f.businessId));
      await db.delete(workExceptions).where(eq(workExceptions.businessId, f.businessId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(productResources).where(inArray(productResources.productId, [f.shared, f.onlyA]));
      await db.delete(products).where(inArray(products.id, [f.shared, f.onlyA]));
      await db.delete(resources).where(eq(resources.businessId, f.businessId));
      await db.delete(businessMembers).where(inArray(businessMembers.id, f.memberIds));
      await db.delete(users).where(inArray(users.id, f.userIds));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("넘기고 이관 — 요청자는 그날 쉬고, 대상이 그 시간에 서고, 예약이 옮겨진다", async () => {
    const f = await make();
    const r = await createReservation({ productId: f.shared, startAt: at(D1, 3), partySize: 1, customerNote: null }, { uid: f.customerId });
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "결혼식", reassignRequester: true, reassignTarget: null }, f.a.actor);
    expect(sw.reservationCount).toBe(1);

    await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    const done = await actOnSwap(f.businessId, sw.id, { action: "APPROVE" }, f.ownerActor, meta);
    expect(done.status).toBe("APPROVED");
    expect(done.movedReservationIds).toEqual([r.id]);

    const [moved] = await db.select({ resourceId: reservations.resourceId }).from(reservations).where(eq(reservations.id, r.id));
    expect(moved.resourceId).toBe(f.b.resourceId);

    const ex = await exceptionsOf(f);
    expect(ex.filter((e) => e.resourceId === f.a.resourceId && e.kind === "OFF" && e.date === iso(D1))).toHaveLength(1);
    // EXTRA 는 **대신 서는 쪽의 그 날짜**에 만든다 — 요청자의 날이 아니다 (명세 3단계)
    const extra = ex.filter((e) => e.resourceId === f.b.resourceId && e.kind === "EXTRA" && e.date === iso(D1));
    expect(extra).toHaveLength(1);
    expect(extra[0].startTime?.slice(0, 5)).toBe("00:00");

    const [log] = await db.select().from(reservationLogs).where(and(eq(reservationLogs.reservationId, r.id), eq(reservationLogs.toResourceId, f.b.resourceId)));
    expect(log.fromResourceId).toBe(f.a.resourceId);
    // 담당만 바뀌고 상태는 그대로여야 한다
    expect(log.fromStatus).toBe(log.toStatus);
  }, 60_000);

  it("넘기되 유지 — 예약은 그대로 두고, 요청자가 그 예약 시간만 나온다", async () => {
    const f = await make();
    const r = await createReservation({ productId: f.shared, startAt: at(D1, 5), partySize: 1, customerNote: null }, { uid: f.customerId });
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "오후 볼일", reassignRequester: false, reassignTarget: null }, f.a.actor);
    await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    await actOnSwap(f.businessId, sw.id, { action: "APPROVE" }, f.ownerActor, meta);

    const [kept] = await db.select({ resourceId: reservations.resourceId }).from(reservations).where(eq(reservations.id, r.id));
    expect(kept.resourceId, "유지인데 옮겨졌다").toBe(f.a.resourceId);
    const mine = (await exceptionsOf(f)).filter((e) => e.resourceId === f.a.resourceId);
    expect(mine.some((e) => e.kind === "OFF")).toBe(true);
    // OFF 위에 예약 시간만 EXTRA — resolve.ts 4·5순위가 만드는 조합
    const only = mine.filter((e) => e.kind === "EXTRA");
    expect(only).toHaveLength(1);
    expect(only[0].startTime?.slice(0, 5)).toBe("14:00"); // KST 09:00 + 5h
  }, 60_000);

  /** 리스크 R4 그 자체 — 여기가 무너지면 근무표만 바뀌고 예약은 원래 사람에게 남는다 */
  it("옮길 수 없는 예약이 하나라도 있으면 근무표도 상태도 그대로다", async () => {
    const f = await make();
    await createReservation({ productId: f.onlyA, startAt: at(D1, 7), partySize: 1, customerNote: null }, { uid: f.customerId });
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    await expect(actOnSwap(f.businessId, sw.id, { action: "APPROVE" }, f.ownerActor, meta)).rejects.toMatchObject({ status: 409, code: "SWAP_CONFLICT" });

    const [row] = await db.select({ status: shiftSwapRequests.status }).from(shiftSwapRequests).where(eq(shiftSwapRequests.id, sw.id));
    expect(row.status).toBe("ACCEPTED");
    expect(await exceptionsOf(f), "근무표가 먼저 바뀌면 되돌릴 사람이 없다").toHaveLength(0);
  }, 60_000);

  it("요청한 뒤 새 예약이 들어오면 사람이 다시 보기 전에는 반영되지 않는다", async () => {
    const f = await make();
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    // 요청과 승인 사이 최대 72시간 — 그 사이에 들어온 예약이다
    await createReservation({ productId: f.shared, startAt: at(D1, 9), partySize: 1, customerNote: null }, { uid: f.customerId });
    await expect(actOnSwap(f.businessId, sw.id, { action: "APPROVE" }, f.ownerActor, meta)).rejects.toMatchObject({ status: 409, code: "SWAP_RESERVATIONS_CHANGED" });
    expect(await exceptionsOf(f)).toHaveLength(0);
  }, 60_000);

  it("자동 승인이면 대상의 수락이 곧 반영이다", async () => {
    const f = await make(true);
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    const r = await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    expect(r.status).toBe("APPROVED");
    expect((await exceptionsOf(f)).length).toBeGreaterThan(0);
  }, 60_000);

  it("맞교대는 두 방향을 다 처리한다 — 한쪽만 반영되면 근무표가 어긋난다", async () => {
    const f = await make();
    const sw = await createSwap(
      f.businessId,
      { targetResourceId: f.b.resourceId, swapType: "EXCHANGE", requestDate: iso(D1), targetDate: iso(D2), reason: "맞교대", reassignRequester: false, reassignTarget: false },
      f.a.actor,
    );
    await actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.b.actor, meta);
    await actOnSwap(f.businessId, sw.id, { action: "APPROVE" }, f.ownerActor, meta);
    const ex = await exceptionsOf(f);
    expect(ex.some((e) => e.resourceId === f.a.resourceId && e.kind === "OFF" && e.date === iso(D1))).toBe(true);
    expect(ex.some((e) => e.resourceId === f.b.resourceId && e.kind === "EXTRA" && e.date === iso(D1))).toBe(true);
    expect(ex.some((e) => e.resourceId === f.b.resourceId && e.kind === "OFF" && e.date === iso(D2))).toBe(true);
    expect(ex.some((e) => e.resourceId === f.a.resourceId && e.kind === "EXTRA" && e.date === iso(D2))).toBe(true);
  }, 60_000);

  it("당사자가 아니면 존재를 알리지 않는다 — 상태를 떠보는 통로가 되면 안 된다", async () => {
    const f = await make();
    const other = await make();
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    await expect(actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, other.a.actor, meta)).rejects.toMatchObject({ status: 404 });
    // 요청자 본인은 수락할 수 없다 — 동의가 아니게 된다
    await expect(actOnSwap(f.businessId, sw.id, { action: "ACCEPT" }, f.a.actor, meta)).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it("같은 두 사람·같은 날 진행 중인 요청은 하나뿐 — 승인 순서에 따라 결과가 달라지면 안 된다", async () => {
    const f = await make();
    await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    await expect(
      createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "또", reassignRequester: true, reassignTarget: null }, f.a.actor),
    ).rejects.toMatchObject({ status: 409, code: "SWAP_EXISTS" });
  }, 60_000);

  it("72시간 무응답이면 만료 — 수락된 뒤 승인을 기다리는 건은 만료되지 않는다", async () => {
    const f = await make();
    const waiting = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    // 나(b)는 D2 요일에만 근무하므로 넘길 근무가 있는 날은 D2 다
    const accepted = await createSwap(f.businessId, { targetResourceId: f.a.resourceId, swapType: "EXCHANGE", requestDate: iso(D2), targetDate: iso(D1), reason: "맞교대", reassignRequester: false, reassignTarget: false }, f.b.actor);
    await actOnSwap(f.businessId, accepted.id, { action: "ACCEPT" }, f.a.actor, meta);

    await expireSwaps(new Date(Date.now() + 80 * 3_600_000));
    const rows = await db.select({ id: shiftSwapRequests.id, status: shiftSwapRequests.status }).from(shiftSwapRequests).where(eq(shiftSwapRequests.businessId, f.businessId));
    expect(rows.find((r) => r.id === waiting.id)?.status).toBe("EXPIRED");
    expect(rows.find((r) => r.id === accepted.id)?.status).toBe("ACCEPTED");
  }, 60_000);

  it("목록은 당사자와 사장님에게만 — 남의 교대 사정은 남의 일이다", async () => {
    const f = await make();
    const other = await make();
    const sw = await createSwap(f.businessId, { targetResourceId: f.b.resourceId, swapType: "GIVE", requestDate: iso(D1), targetDate: null, reason: "교대", reassignRequester: true, reassignTarget: null }, f.a.actor);
    expect((await listSwaps(f.businessId, f.b.actor)).map((s) => s.id)).toContain(sw.id);
    expect((await listSwaps(f.businessId, f.ownerActor)).map((s) => s.id)).toContain(sw.id);
    expect((await listSwaps(f.businessId, other.a.actor)).map((s) => s.id)).not.toContain(sw.id);
    // 대상은 수락·거절만, 사장님은 아직 아무것도 (수락 전이라 승인 대상이 아니다)
    expect((await listSwaps(f.businessId, f.b.actor)).find((s) => s.id === sw.id)?.can.sort()).toEqual(["ACCEPT", "REJECT"]);
    expect((await listSwaps(f.businessId, f.a.actor)).find((s) => s.id === sw.id)?.can).toEqual(["CANCEL"]);
  }, 60_000);
});
