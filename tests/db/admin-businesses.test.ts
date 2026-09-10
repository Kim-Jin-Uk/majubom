import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessMembers, businesses, productResources, products, reservationLogs, reservations, resources, sessions, users, workSchedules } from "@/db/schema";
import { decideApplication, listApplications, listBusinesses, setBusinessStatus } from "@/features/admin/businesses";
import { createReservation } from "@/features/booking/create";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 가입 심사 (FR-ADM-010, #65) · 사업장 상태 제어 (FR-ADM-020, #66).
 *
 * 지키는 것 셋:
 *   1) **이메일 검증 전 신청은 심사 대상이 아니다** — 큐에도 없고, id 를 직접 넣어도 거부한다
 *   2) **차단이 남은 예약을 조용히 지나가지 않는다** — 함께 취소하거나, 남는다는 걸 확인해야 진행된다
 *   3) **정지·차단은 세션을 끊는다** — 상태만 바꾸면 사업자는 콘솔이 왜 안 되는지 모른 채 새로 고친다
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { id: null, delivered: false }; }) }));

const meta = { ip: null, userAgent: null };
const START = new Date(Date.now() + 3 * 86_400_000);
START.setUTCHours(0, 0, 0, 0);
const at = (h: number) => new Date(START.getTime() + h * 3_600_000).toISOString();

async function fixture(status: "PENDING" | "APPROVED" = "PENDING", emailVerified = true) {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({
      slug: `ad-${tag}`,
      name: `심사 ${tag}`,
      bizRegNo: fakeBizRegNo(),
      category: "etc",
      status,
      timezone: "Asia/Seoul",
      emailVerifiedAt: emailVerified ? new Date() : null,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dow: d, open: "00:00", close: "00:00" })),
      policy: { ...DEFAULT_POLICY, minLeadTimeMin: 0, maxAdvanceDays: 365, maxActivePerCustomer: 10, autoConfirm: true },
    })
    .returning({ id: businesses.id });
  const [ownerU] = await db.insert(users).values({ email: `own-${tag}@test.local`, name: "사장", provider: "LOCAL" }).returning({ id: users.id });
  const [ownerM] = await db.insert(businessMembers).values({ userId: ownerU.id, businessId: biz.id, role: "OWNER", status: "ACTIVE" }).returning({ id: businessMembers.id });
  const [adminU] = await db.insert(users).values({ email: `adm-${tag}@test.local`, name: "운영자", provider: "LOCAL", globalRole: "ADMIN" }).returning({ id: users.id });
  const [room] = await db.insert(resources).values({ businessId: biz.id, type: "SPACE", name: "룸", capacity: 1 }).returning({ id: resources.id });
  const [prd] = await db
    .insert(products)
    .values({ businessId: biz.id, name: "대여", startMode: "FREE", slotIntervalMin: 60, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "NONE", status: "ACTIVE" })
    .returning({ id: products.id });
  await db.insert(productResources).values({ productId: prd.id, resourceId: room.id });
  const [cust] = await db.insert(users).values({ email: `c-${tag}@test.local`, name: "손님", provider: "LOCAL" }).returning({ id: users.id });
  // 사업자의 살아 있는 세션 — 정지·차단이 끊어야 한다
  await db.insert(sessions).values({ userId: ownerU.id, tokenHash: `h-${tag}`, expiresAt: new Date(Date.now() + 30 * 86_400_000) });
  return { businessId: biz.id, ownerUserId: ownerU.id, productId: prd.id, resourceId: room.id, customerId: cust.id, admin: { uid: adminU.id }, userIds: [ownerU.id, adminU.id, cust.id], memberIds: [ownerM.id] };
}

type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async (...args: Parameters<typeof fixture>) => {
  const f = await fixture(...args);
  made.push(f);
  return f;
};
const liveSessions = (userId: string) => db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
const auditOf = (f: F) => db.select({ action: auditLogs.action, diff: auditLogs.diff }).from(auditLogs).where(eq(auditLogs.businessId, f.businessId));

describe.skipIf(!dbTestEnabled())("관리자 콘솔 — 심사 · 상태 제어", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(async () => {
    for (const f of made) {
      const ids = (await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.businessId, f.businessId))).map((r) => r.id);
      if (ids.length) await db.delete(reservationLogs).where(inArray(reservationLogs.reservationId, ids));
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.delete(reservations).where(eq(reservations.businessId, f.businessId));
      await db.delete(sessions).where(inArray(sessions.userId, f.userIds));
      await db.delete(workSchedules).where(eq(workSchedules.businessId, f.businessId));
      await db.delete(productResources).where(eq(productResources.productId, f.productId));
      await db.delete(products).where(eq(products.id, f.productId));
      await db.delete(resources).where(eq(resources.id, f.resourceId));
      await db.delete(businessMembers).where(inArray(businessMembers.id, f.memberIds));
      await db.delete(users).where(inArray(users.id, f.userIds));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("이메일 검증 전 신청은 큐에 없고, id 를 직접 넣어도 심사할 수 없다", async () => {
    const f = await make("PENDING", false);
    expect((await listApplications()).map((a) => a.id)).not.toContain(f.businessId);
    await expect(decideApplication(f.businessId, { decision: "APPROVE", reason: null }, f.admin, meta)).rejects.toMatchObject({ status: 409, code: "EMAIL_UNVERIFIED" });
  }, 30_000);

  it("승인하면 공개 URL 이 열리고 감사 로그와 메일이 남는다", async () => {
    const f = await make();
    expect((await listApplications()).map((a) => a.id)).toContain(f.businessId);
    await decideApplication(f.businessId, { decision: "APPROVE", reason: null }, f.admin, meta);
    const [row] = await db.select({ status: businesses.status, approvedAt: businesses.approvedAt }).from(businesses).where(eq(businesses.id, f.businessId));
    expect(row.status).toBe("APPROVED");
    expect(row.approvedAt).not.toBeNull();
    expect((await auditOf(f)).map((a) => a.action)).toContain("BUSINESS_APPROVE");
    expect(sent.at(-1)?.subject).toContain("승인");
    // 두 번 심사하지 않는다
    await expect(decideApplication(f.businessId, { decision: "REJECT", reason: "번복" }, f.admin, meta)).rejects.toMatchObject({ status: 409, code: "NOT_PENDING" });
  }, 30_000);

  it("반려는 사유를 사업자에게 그대로 전한다 — 무엇을 고쳐야 하는지 알아야 다시 신청한다", async () => {
    const f = await make();
    await decideApplication(f.businessId, { decision: "REJECT", reason: "사업자등록증의 상호와 신청 상호가 다릅니다" }, f.admin, meta);
    const [row] = await db.select({ status: businesses.status, rejectedReason: businesses.rejectedReason }).from(businesses).where(eq(businesses.id, f.businessId));
    expect(row.status).toBe("REJECTED");
    expect(row.rejectedReason).toContain("상호가 다릅니다");
    expect(sent.at(-1)?.text).toContain("상호가 다릅니다");
  }, 30_000);

  /** 이게 없으면 운영자가 무엇을 무너뜨리는지 모른 채 차단 버튼을 누른다 */
  it("차단인데 앞으로 잡힌 예약이 남아 있으면 한 번 막는다 — 상태는 그대로", async () => {
    const f = await make("APPROVED");
    await createReservation({ productId: f.productId, startAt: at(3), partySize: 1, customerNote: null }, { uid: f.customerId });
    await expect(setBusinessStatus(f.businessId, { status: "BLOCKED", reason: "허위 사업자" }, f.admin, meta)).rejects.toMatchObject({ status: 409, code: "LIVE_RESERVATIONS" });
    const [row] = await db.select({ status: businesses.status }).from(businesses).where(eq(businesses.id, f.businessId));
    expect(row.status).toBe("APPROVED");
    expect(await liveSessions(f.ownerUserId)).toHaveLength(1);
  }, 30_000);

  it("함께 취소를 고르면 확정 예약도 사유와 함께 취소되고 손님에게 메일이 간다", async () => {
    const f = await make("APPROVED");
    const r = await createReservation({ productId: f.productId, startAt: at(5), partySize: 1, customerNote: null }, { uid: f.customerId });
    const out = await setBusinessStatus(f.businessId, { status: "BLOCKED", reason: "허위 사업자", cancelReservations: true }, f.admin, meta);
    expect(out.canceled).toBe(1);
    const [row] = await db.select({ status: reservations.status, reason: reservations.cancelReason }).from(reservations).where(eq(reservations.id, r.id));
    expect(row.status).toBe("CANCELED_BY_BIZ");
    expect(row.reason).toBe("허위 사업자");
    expect(sent.some((m) => m.subject.includes("예약이 취소되었습니다"))).toBe(true);
    // 차단은 세션을 끊는다
    expect(await liveSessions(f.ownerUserId)).toHaveLength(0);
    expect((await auditOf(f)).map((a) => a.action)).toContain("BUSINESS_BLOCK");
  }, 30_000);

  it("일시정지는 확정 예약을 건드리지 않는다 — 손님이 이미 잡은 자리는 지킨다", async () => {
    const f = await make("APPROVED");
    const r = await createReservation({ productId: f.productId, startAt: at(7), partySize: 1, customerNote: null }, { uid: f.customerId });
    await setBusinessStatus(f.businessId, { status: "SUSPENDED", reason: "정산 확인 중" }, f.admin, meta);
    const [row] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, r.id));
    expect(row.status).toBe("CONFIRMED");
    expect(await liveSessions(f.ownerUserId)).toHaveLength(0);
  }, 30_000);

  it("복구는 세션을 끊지 않는다 — 끊을 이유가 없다", async () => {
    const f = await make("APPROVED");
    await db.insert(sessions).values({ userId: f.ownerUserId, tokenHash: `r-${f.businessId}`, expiresAt: new Date(Date.now() + 86_400_000) });
    await setBusinessStatus(f.businessId, { status: "SUSPENDED", reason: "확인" }, f.admin, meta);
    await db.insert(sessions).values({ userId: f.ownerUserId, tokenHash: `r2-${f.businessId}`, expiresAt: new Date(Date.now() + 86_400_000) });
    await setBusinessStatus(f.businessId, { status: "APPROVED", reason: "확인 완료" }, f.admin, meta);
    expect(await liveSessions(f.ownerUserId)).toHaveLength(1);
    expect(sent.at(-1)?.subject).toContain("다시 열렸습니다");
  }, 30_000);

  it("심사 전·반려된 사업장은 상태 제어 대상이 아니다", async () => {
    const f = await make();
    await expect(setBusinessStatus(f.businessId, { status: "SUSPENDED", reason: "왜" }, f.admin, meta)).rejects.toMatchObject({ status: 409, code: "NOT_APPROVED" });
  }, 30_000);

  it("사업장 목록은 심사가 끝난 것만 — 대기 중인 신청은 심사 화면의 몫이다", async () => {
    const pending = await make();
    const live = await make("APPROVED");
    const ids = (await listBusinesses()).map((b) => b.id);
    expect(ids).toContain(live.businessId);
    expect(ids).not.toContain(pending.businessId);
  }, 30_000);
});
