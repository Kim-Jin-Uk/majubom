import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessMembers, businesses, productResources, products, reservationLogs, reservations, resources, users, workSchedules } from "@/db/schema";
import { createReservation, createWalkIn } from "@/features/booking/create";
import { transitionReservation } from "@/features/booking/transitions";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 예약 메일 (#57) — 보내는 판단이 DB 상태(워크인인지·어떤 전이인지)에 달려 있어 여기서 본다.
 *
 * 지키는 것 셋:
 *   1) **손님이 결과를 알 수 없는 상태로 남지 않는다** — 접수·확정·거절·매장취소·만료 다섯 갈래
 *   2) **손님이 스스로 한 일에는 메일을 보내지 않는다** — 본인 취소로 "취소되었습니다" 를 받으면 매장이 취소한 줄 안다
 *   3) **메일 실패가 예약을 되돌리지 않는다** — 예약은 이미 커밋됐다. 여기서 던지면 화면엔 실패인데 자리는 잡혀 있다
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
const sendMail = vi.hoisted(() => vi.fn(async (m: { to: string; subject: string; text: string }) => {
  sent.push(m);
  return { id: null, delivered: false };
}));
vi.mock("@/lib/mail", () => ({ sendMail }));

const TZ = "Asia/Seoul";
const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCHours(0, 0, 0, 0);
const at = (h: number) => new Date(START.getTime() + h * 3_600_000).toISOString();

async function fixture(autoConfirm: boolean) {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `ml-${tag}`,
      name: `메일 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "etc",
      status: "APPROVED",
      timezone: TZ,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 10, autoConfirm },
    })
    .returning({ id: businesses.id });

  const [ownerU] = await db.insert(users).values({ email: `o-${tag}@test.local`, name: "사장", provider: "LOCAL" }).returning({ id: users.id });
  const [owner] = await db.insert(businessMembers).values({ userId: ownerU.id, businessId: biz.id, role: "OWNER", status: "ACTIVE" }).returning({ id: businessMembers.id });
  const [room] = await db.insert(resources).values({ businessId: biz.id, type: "STAFF", name: "자리", capacity: 1, memberId: owner.id }).returning({ id: resources.id });
  await db.insert(workSchedules).values(
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ businessId: biz.id, resourceId: room.id, dayOfWeek, startTime: "00:00", endTime: "23:59", breaks: [], effectiveFrom: "2020-01-01" })),
  );
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "시술 60분", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: room.id });

  const custEmail = `c-${tag}@test.local`;
  const [cust] = await db.insert(users).values({ email: custEmail, name: "김고객", provider: "KAKAO" }).returning({ id: users.id });
  const [walkInU] = await db.insert(users).values({ email: `walkin+${biz.id}@internal`, name: "워크인", provider: "LOCAL" }).returning({ id: users.id });

  return {
    businessId: biz.id,
    productId: prd.id,
    resourceId: room.id,
    customerId: cust.id,
    customerEmail: custEmail,
    walkInId: walkInU.id,
    owner: { kind: "CONSOLE" as const, uid: ownerU.id, role: "OWNER" as const, memberId: owner.id, businessId: biz.id, canViewAll: true },
    userIds: [ownerU.id, cust.id, walkInU.id],
    memberIds: [owner.id],
  };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async (autoConfirm: boolean) => {
  const f = await fixture(autoConfirm);
  made.push(f);
  sent.length = 0;
  sendMail.mockClear();
  return f;
};

describe.skipIf(!dbTestEnabled())("예약 메일 (#57)", () => {
  afterEach(() => {
    sendMail.mockImplementation(async (m) => {
      sent.push(m);
      return { id: null, delivered: false };
    });
  });

  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      // 전이는 감사 로그를 남긴다 — users 보다 먼저 지우지 않으면 actor_id FK 로 정리가 막힌다
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.id, f.productId));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(resources).where(eq(resources.id, f.resourceId));
      await db.delete(businessMembers).where(inArray(businessMembers.id, f.memberIds));
      await db.delete(users).where(inArray(users.id, f.userIds));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("자동 확정이면 확정 메일 한 통 — 예약번호·상호·가게 시각이 들어 있다", async () => {
    const f = await make(true);
    const r = await createReservation({ productId: f.productId, startAt: at(3), partySize: 1, customerNote: null }, { uid: f.customerId });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(f.customerEmail);
    expect(sent[0].subject).toContain("예약이 확정되었습니다");
    expect(sent[0].text).toContain(r.code);
    expect(sent[0].text).toContain("시술 60분");
    // 가게 시각(KST) 로 적힌다 — 서버 시계(UTC)가 아니다
    expect(sent[0].text).toMatch(/\d{4}년 \d+월 \d+일 \(.\) \d{2}:\d{2} – \d{2}:\d{2}/);
  }, 30_000);

  it("승인제면 먼저 접수 메일, 매장이 승인하면 확정 메일 — 접수 메일은 확정이 아니라고 말한다", async () => {
    const f = await make(false);
    const r = await createReservation({ productId: f.productId, startAt: at(4), partySize: 1, customerNote: null }, { uid: f.customerId });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("접수되었습니다");
    expect(sent[0].text).toContain("아직 확정은 아닙니다");

    await transitionReservation(r.id, "CONFIRMED", f.owner);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain("확정되었습니다");
  }, 30_000);

  it("거절·매장 취소는 매장이 쓴 사유를 그대로 담는다", async () => {
    const f = await make(false);
    const a = await createReservation({ productId: f.productId, startAt: at(5), partySize: 1, customerNote: null }, { uid: f.customerId });
    await transitionReservation(a.id, "REJECTED", f.owner, { reason: "그날은 정기 휴무입니다" });
    expect(sent.at(-1)!.subject).toContain("거절되었습니다");
    expect(sent.at(-1)!.text).toContain("그날은 정기 휴무입니다");

    const b = await createReservation({ productId: f.productId, startAt: at(6), partySize: 1, customerNote: null }, { uid: f.customerId });
    await transitionReservation(b.id, "CONFIRMED", f.owner);
    await transitionReservation(b.id, "CANCELED_BY_BIZ", f.owner, { reason: "설비 고장" });
    expect(sent.at(-1)!.subject).toContain("취소되었습니다");
    expect(sent.at(-1)!.text).toContain("설비 고장");
  }, 30_000);

  it("손님 본인 취소에는 메일을 보내지 않는다 — 매장이 취소한 것으로 읽힌다", async () => {
    const f = await make(false);
    const r = await createReservation({ productId: f.productId, startAt: at(7), partySize: 1, customerNote: null }, { uid: f.customerId });
    sent.length = 0;
    await transitionReservation(r.id, "CANCELED_BY_USER", { kind: "CUSTOMER", uid: f.customerId });
    expect(sent).toHaveLength(0);
  }, 30_000);

  it("승인 대기 만료(C2)도 알린다 — 없으면 손님은 '접수됨' 에서 소식이 끊긴 채 가게 앞에 선다", async () => {
    const f = await make(false);
    const r = await createReservation({ productId: f.productId, startAt: at(8), partySize: 1, customerNote: null }, { uid: f.customerId });
    sent.length = 0;
    // 배치(`expireRequests`)를 부르지 않는다 — 그 함수는 DB 전체를 훑어서, 병렬로 도는 다른 테스트 파일의
    // REQUESTED 건까지 만료시킨다. 메일 판단은 전이 하나에 달려 있으므로 같은 전이를 직접 일으킨다
    await transitionReservation(r.id, "EXPIRED", { kind: "SYSTEM" });
    expect(sent.at(-1)!.subject).toContain("만료되었습니다");
  }, 30_000);

  it("워크인에는 보내지 않는다 — 고객 계정이 사업장 내부 계정이라 보낼 곳이 없다", async () => {
    const f = await make(true);
    sent.length = 0;
    await createWalkIn({ productId: f.productId, resourceId: f.resourceId, startAt: at(9), partySize: 1, guestLabel: "현장 손님" }, { customerId: f.walkInId, businessId: f.businessId });
    expect(sent).toHaveLength(0);
  }, 30_000);

  it("메일 발송이 실패해도 예약은 그대로다 — 여기서 던지면 화면엔 실패인데 자리는 잡혀 있다", async () => {
    const f = await make(true);
    sendMail.mockRejectedValueOnce(new Error("Resend 503"));
    const r = await createReservation({ productId: f.productId, startAt: at(10), partySize: 1, customerNote: null }, { uid: f.customerId });
    const [row] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, r.id));
    expect(row.status).toBe("CONFIRMED");
  }, 30_000);
});
