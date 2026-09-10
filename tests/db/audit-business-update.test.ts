import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { auditLogs, businessSlugHistory, businesses, users } from "@/db/schema";
import { hashPii } from "@/lib/audit";
import { DEFAULT_POLICY } from "@/features/business/policy-defaults";
import { updateBusinessInfo, type BusinessInfoInput } from "@/features/business/settings";
import { dbTestEnabled, fakeBizRegNo } from "./_fixture";

/**
 * 사업장 정보 변경의 감사 로그 (FR-ADM-040, #56).
 *
 * 지키는 것 둘: **변경된 필드만** 남긴다, **연락처·주소는 해시**다.
 * 레코드를 통째로 담으면 연락처가 로그에 복제돼 마스킹 배치(FR-PRIV-010)의 사정권 밖에 남는다 —
 * 1년 뒤 예약 테이블의 전화번호는 지워지는데 감사 로그의 사본은 그대로 있는 상태가 된다.
 */
const meta = { ip: null, userAgent: null };
const HOURS = [1, 2, 3, 4, 5].map((dow) => ({ dow, open: "10:00", close: "20:00" }));

async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const [biz] = await db
    .insert(businesses)
    .values({ slug: `aud-${tag}`, name: `감사 ${tag}`, bizRegNo: fakeBizRegNo(), category: "nail", status: "APPROVED", phone: "02-111-2222", address: "서울 마포구 옛길 1", openingHours: HOURS, policy: DEFAULT_POLICY })
    .returning({ id: businesses.id, slug: businesses.slug });
  await db.insert(businessSlugHistory).values({ businessId: biz.id, slug: biz.slug });
  const [owner] = await db.insert(users).values({ email: `o-${tag}@test.local`, name: "사장님", provider: "LOCAL" }).returning({ id: users.id });
  return { businessId: biz.id, ownerId: owner.id };
}
type F = Awaited<ReturnType<typeof fixture>>;
const made: F[] = [];
const make = async () => {
  const f = await fixture();
  made.push(f);
  return f;
};

const input = (over: Partial<BusinessInfoInput> = {}): BusinessInfoInput =>
  ({ name: `감사 상호`, category: "nail", phone: "02-111-2222", address: "서울 마포구 옛길 1", addressDetail: null, description: null, timezone: "Asia/Seoul", openingHours: HOURS, ...over }) as BusinessInfoInput;

const logs = (businessId: string) => db.select({ diff: auditLogs.diff, actorRole: auditLogs.actorRole }).from(auditLogs).where(and(eq(auditLogs.businessId, businessId), eq(auditLogs.action, "BUSINESS_UPDATE")));

describe.skipIf(!dbTestEnabled())("사업장 정보 변경 감사 로그 (#56)", () => {
  afterAll(async () => {
    for (const f of made) {
      await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));
      await db.delete(businessSlugHistory).where(eq(businessSlugHistory.businessId, f.businessId));
      await db.delete(users).where(eq(users.id, f.ownerId));
      await db.delete(businesses).where(eq(businesses.id, f.businessId));
    }
    await pool.end();
  });

  it("바뀐 것이 없으면 아무것도 쓰지 않는다", async () => {
    const f = await make();
    // 첫 저장은 name 이 다르므로 한 줄이 남는다. 같은 값을 다시 저장하면 늘지 않아야 한다
    await updateBusinessInfo(f.businessId, input(), { uid: f.ownerId, role: "OWNER" }, meta);
    const n = (await logs(f.businessId)).length;
    await updateBusinessInfo(f.businessId, input(), { uid: f.ownerId, role: "OWNER" }, meta);
    expect((await logs(f.businessId)).length, "같은 값 재저장").toBe(n);
  }, 30_000);

  it("변경된 필드만 남는다 — 레코드 전체가 아니다", async () => {
    const f = await make();
    await updateBusinessInfo(f.businessId, input(), { uid: f.ownerId, role: "OWNER" }, meta);
    await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));

    await updateBusinessInfo(f.businessId, input({ name: "새 상호" }), { uid: f.ownerId, role: "OWNER" }, meta);
    const [row] = await logs(f.businessId);
    expect(Object.keys(row.diff!), "상호만 바꿨다").toEqual(["name"]);
    expect(row.diff).toEqual({ name: { from: "감사 상호", to: "새 상호" } });
    expect(row.actorRole).toBe("OWNER");
  }, 30_000);

  it("연락처·주소는 해시로 대체한다 — 원문이 로그에 복제되면 마스킹 배치가 못 지운다", async () => {
    const f = await make();
    await updateBusinessInfo(f.businessId, input(), { uid: f.ownerId, role: "OWNER" }, meta);
    await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));

    await updateBusinessInfo(f.businessId, input({ phone: "010-9999-8888", address: "서울 강남구 새길 2" }), { uid: f.ownerId, role: "OWNER" }, meta);
    const [row] = await logs(f.businessId);
    const text = JSON.stringify(row.diff);
    expect(text, "새 전화번호 원문").not.toContain("010-9999-8888");
    expect(text, "옛 전화번호 원문").not.toContain("02-111-2222");
    expect(text, "주소 원문").not.toContain("강남구");
    expect(row.diff).toMatchObject({
      phone: { from: hashPii("02-111-2222"), to: hashPii("010-9999-8888") },
      address: { from: hashPii("서울 마포구 옛길 1"), to: hashPii("서울 강남구 새길 2") },
    });
  }, 30_000);

  it("긴 자유 입력은 '바뀌었다' 만 남긴다", async () => {
    const f = await make();
    await updateBusinessInfo(f.businessId, input(), { uid: f.ownerId, role: "OWNER" }, meta);
    await db.delete(auditLogs).where(eq(auditLogs.businessId, f.businessId));

    await updateBusinessInfo(f.businessId, input({ description: "가".repeat(500), openingHours: [{ dow: 1, open: "09:00", close: "21:00" }] }), { uid: f.ownerId, role: "OWNER" }, meta);
    const [row] = await logs(f.businessId);
    expect(row.diff).toEqual({ description: { from: null, to: "(변경됨)" }, openingHours: { from: "(변경됨)", to: "(변경됨)" } });
    expect(JSON.stringify(row.diff).length, "2000자를 두 벌 복제하지 않는다").toBeLessThan(200);
  }, 30_000);

  it("행위자가 없어도 기록은 남는다 (배치 경로)", async () => {
    const f = await make();
    await updateBusinessInfo(f.businessId, input({ name: "배치가 고침" }));
    const [row] = await logs(f.businessId);
    expect(row.actorRole).toBe("SYSTEM");
  }, 30_000);
});
