/**
 * 로컬 테스트용 계정·사업장 시드. 프로덕션이 아닌 DB 에만.
 *   npm run db:seed:test
 *
 * 만드는 것 (이미 있으면 그대로 두고 계정 정보만 다시 찍는다):
 *   - 사장님  owner@example.com   / test1234   — 사업장 "봄 네일" (사업자번호 체크섬 통과, 이메일 인증 완료, 심사 PENDING)
 *   - 매니저  manager@example.com / test1234   — STAFF 자원 "이디자이너" 에 연결된 매니저 (초대 수락 상태, 권한 4종 전부)
 *   - 자원: 김디자이너·이디자이너(STAFF), A룸(SPACE) · 영업시간 월~토 10–20 (휴게 13–14) · 타임존 Asia/Seoul
 *   - 근무 패턴: 두 담당자 월~금 10–19 (휴게 13–14), 오늘부터
 *   - 상품 "젤네일"(60분) + 다음 주 예약 3건 (화 15:00 · 화 23:00→수 01:00 자정 넘김 · 이디자이너 수 11:00) — 그리드 '예약 N건'·휴무 충돌 확인용
 *   - 이디자이너의 휴가 신청 1건 (다음 주 목 종일, 승인 대기) — 사장님 근무표 상단 '승인 대기' 패널 확인용
 *
 * 가입 흐름(OTP)·초대 흐름(링크)은 건너뛰고 검증 완료 상태로 직접 놓는다. 나머지는 실제 서비스 함수를 그대로 써서 불변식을 지킨다.
 * 다시 깨끗하게 하려면 db:reset.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const OWNER = { email: "owner@example.com", password: "test1234", name: "최사장" };
const MANAGER = { email: "manager@example.com", password: "test1234", name: "이디자이너" };

function assertNotProduction() {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
  if (process.env.NODE_ENV === "production" || /prod/i.test(dbName)) throw new Error("프로덕션으로 보이는 DB 에는 시드를 넣지 않는다");
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function main() {
  assertNotProduction();
  const { eq, sql } = await import("drizzle-orm");
  const { db, pool } = await import("../../src/db/client");
  const { businesses, businessMembers, reservations, users } = await import("../../src/db/schema");
  const { applyBusiness } = await import("../../src/features/auth/business-signup");
  const { hashPassword } = await import("../../src/features/auth/crypto");
  const { inviteManager } = await import("../../src/features/auth/members");
  const { createException } = await import("../../src/features/schedule/work-exceptions");
  const { updateBusinessInfo, businessInfoSchema } = await import("../../src/features/business/settings");
  const { createResource, resourceInputSchema } = await import("../../src/features/business/resources");
  const { createProduct } = await import("../../src/features/product/products");
  const { productInputSchema } = await import("../../src/features/product/schema");
  const { setPattern, patternInputSchema } = await import("../../src/features/schedule/work-schedules");
  const { todayIn } = await import("../../src/lib/dates");
  const meta = { ip: null, userAgent: "seed-test" };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, OWNER.email)).limit(1);
  if (existing) {
    console.log("이미 시드가 있어요 — 그대로 둡니다. 다시 만들려면 db:reset 후 실행.");
    printAccounts();
    await pool.end();
    return;
  }

  // 1) 사업자 가입 (실제 함수) → OTP 검증은 건너뛰고 인증 완료로
  const { userId: ownerId, businessId } = await applyBusiness(
    { email: OWNER.email, password: OWNER.password, ownerName: OWNER.name, phone: "01011112222", businessName: "봄 네일", bizRegNo: "2208162517", category: "nail", address: "서울특별시 강남구 테스트로 1" },
    meta,
  );
  const now = new Date();
  await db.update(businesses).set({ emailVerifiedAt: now }).where(eq(businesses.id, businessId));
  await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, ownerId));
  console.log(`✓ 사업장 ${businessId} (PENDING · 이메일 인증 완료)`);

  // 2) 설정: 타임존·영업시간
  await updateBusinessInfo(
    businessId,
    businessInfoSchema.parse({
      name: "봄 네일",
      category: "nail",
      phone: "0233334444",
      address: "서울특별시 강남구 테스트로 1",
      timezone: "Asia/Seoul",
      openingHours: [1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "10:00", close: "20:00", breaks: [{ start: "13:00", end: "14:00" }] })),
    }),
  );
  const today = todayIn("Asia/Seoul");

  // 3) 자원
  const s1 = (await createResource(businessId, resourceInputSchema.parse({ type: "STAFF", name: "김디자이너", capacity: 1 }))).id;
  const s2 = (await createResource(businessId, resourceInputSchema.parse({ type: "STAFF", name: MANAGER.name, capacity: 1 }))).id;
  await createResource(businessId, resourceInputSchema.parse({ type: "SPACE", name: "A룸", capacity: 1 }));
  console.log("✓ 자원 3개 (김디자이너 · 이디자이너 · A룸)");

  // 4) 매니저 초대 (같은 이름의 STAFF 자원에 자동 연결) → 링크 수락은 건너뛰고 비밀번호·ACTIVE 로
  const { memberId } = await inviteManager(businessId, { uid: ownerId, name: OWNER.name }, { name: MANAGER.name, email: MANAGER.email, permissions: { editProduct: true, replyReview: true, viewAllReservations: true, handleChat: true } }, meta);
  const [mgrUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, MANAGER.email)).limit(1);
  await db.update(users).set({ passwordHash: await hashPassword(MANAGER.password), emailVerifiedAt: now }).where(eq(users.id, mgrUser.id));
  await db.update(businessMembers).set({ status: "ACTIVE" }).where(eq(businessMembers.id, memberId));
  console.log("✓ 매니저 계정 (이디자이너 자원 연결)");

  // 5) 근무 패턴: 월~금 10–19, 휴게 13–14
  const days = [1, 2, 3, 4, 5].map((dow) => ({ dow, startTime: "10:00", endTime: "19:00", breaks: [{ start: "13:00", end: "14:00" }] }));
  await setPattern(businessId, [s1, s2], patternInputSchema.parse({ effectiveFrom: today, days }), today);
  console.log(`✓ 근무 패턴 (${today} 부터, 월~금 10–19)`);

  // 6) 상품 + 다음 주 예약 (예약 UI 는 예약 엔진 에픽에서 — 지금은 직접 넣는다)
  const { id: productId } = await createProduct(
    businessId,
    productInputSchema.parse({ name: "젤네일", startMode: "FREE", slotIntervalMin: 30, durationMin: 60, capacityPerSlot: 1, maxPartySize: 1, resourceIds: [s1, s2], resourceSelectMode: "OPTIONAL", status: "ACTIVE" }),
  );
  const [customer] = await db.insert(users).values({ email: "customer@example.com", name: "김고객", phone: "01099998888", passwordHash: await hashPassword("test1234"), provider: "LOCAL", emailVerifiedAt: now }).returning({ id: users.id });
  let d = addDays(today, 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 2) d = addDays(d, 1); // 다음 화요일
  const tue = d;
  const wed = addDays(tue, 1);
  const seed = [
    { resourceId: s1, start: `${tue} 15:00+09`, end: `${tue} 16:00+09` },
    { resourceId: s1, start: `${tue} 23:00+09`, end: `${wed} 01:00+09` },
    { resourceId: s2, start: `${wed} 11:00+09`, end: `${wed} 12:00+09` },
  ];
  for (const [i, r] of seed.entries()) {
    const mins = (new Date(r.end.replace(" ", "T").replace("+09", "+09:00")).getTime() - new Date(r.start.replace(" ", "T").replace("+09", "+09:00")).getTime()) / 60000;
    await db.insert(reservations).values({
      code: `TEST${String(i + 1).padStart(4, "0")}`,
      businessId,
      productId,
      resourceId: r.resourceId,
      customerId: customer.id,
      startAt: sql`${r.start}::timestamptz`,
      endAt: sql`${r.end}::timestamptz`,
      occupyRange: sql`tstzrange(${r.start}::timestamptz, ${r.end}::timestamptz)`,
      exclusive: true,
      durationMin: mins,
      cancelDeadlineHours: 24,
      partySize: 1,
      status: "CONFIRMED",
      createdVia: "WEB",
    });
  }
  console.log(`✓ 상품 '젤네일' + 예약 ${seed.length}건 (${tue} 화 15:00 · 화 23:00→수 01:00 · 이디자이너 수 11:00)`);

  // 7) 이디자이너의 휴가 신청 (승인 대기) — 사장님 화면의 '승인 대기' 패널
  const thu = addDays(wed, 1);
  await createException(businessId, { resourceId: s2, date: thu, kind: "OFF", reason: "가족 행사", leave: true }, { uid: mgrUser.id, role: "MANAGER", memberId });
  console.log(`✓ 휴가 신청 1건 (이디자이너 ${thu} 목 종일 · 승인 대기)`);
  console.log(`  근무표: /console/schedule?week=${addDays(tue, -2)}`);
  printAccounts();
  await pool.end();
}

function printAccounts() {
  console.log("\n계정 (비밀번호 모두 test1234)");
  console.log(`  사장님  ${OWNER.email}`);
  console.log(`  매니저  ${MANAGER.email}`);
  console.log("  고객    customer@example.com");
}

main().catch(async (e) => {
  console.error("✗", e?.details ?? e?.message ?? e);
  process.exit(1);
});
