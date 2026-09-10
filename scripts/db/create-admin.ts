/**
 * ADMIN 계정을 만들거나(없으면) 승격한다(있으면). 관리자 셀프 가입 UI 는 없다 — FR-ADM 은 운영자 1인 전제다.
 *
 *   ADMIN_PASSWORD='…' npm run admin:create -- admin@majubom.kr "관리자"
 *
 * **비밀번호는 인자로 받지 않는다.** 명령행 인자는 셸 히스토리와 `ps` 에 그대로 남는다 — 환경변수로 받고,
 * 화면에도 찍지 않는다. 기존 계정이면 비밀번호는 건드리지 않고 역할만 올린다(운영자가 쓰던 계정을 잠그지 않게).
 *
 * 승격만으로는 `/admin` 이 열리지 않는다. 첫 진입에서 **TOTP 등록이 강제된다** (FR-AUTH-030 "ADMIN 은 2단계 필수").
 */
import { config as loadEnv } from "dotenv";
import { describeConnError } from "./_conn";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv[3]?.trim() || "관리자";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) {
    console.error('사용법: ADMIN_PASSWORD=\'…\' npm run admin:create -- <email> ["이름"]');
    process.exit(2);
  }

  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../../src/db/client");
  const { users } = await import("../../src/db/schema");
  const { emailSchema, passwordSchema } = await import("../../src/features/auth/validation");
  const { hashPassword } = await import("../../src/features/auth/crypto");

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) {
    console.error(`✗ 이메일 형식이 아닙니다: ${email}`);
    await pool.end();
    process.exit(2);
  }

  const [existing] = await db.select({ id: users.id, name: users.name, globalRole: users.globalRole }).from(users).where(eq(users.email, parsedEmail.data)).limit(1);

  if (existing) {
    if (existing.globalRole === "ADMIN") console.log(`= 이미 ADMIN: ${existing.name} (${existing.id})`);
    else {
      await db.update(users).set({ globalRole: "ADMIN" }).where(eq(users.id, existing.id));
      console.log(`✓ ADMIN 승격: ${existing.name} (${existing.id})`);
    }
    console.log("  비밀번호는 건드리지 않았습니다. 다음: /login 으로 로그인 → /admin 첫 진입에서 TOTP 등록");
    await pool.end();
    return;
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    console.error(`✗ ADMIN_PASSWORD: ${parsed.error.issues[0].message}`);
    console.error('  예: ADMIN_PASSWORD=\'…\' npm run admin:create -- admin@majubom.kr "관리자"');
    await pool.end();
    process.exit(2);
  }

  const [row] = await db
    .insert(users)
    .values({
      email: parsedEmail.data,
      name,
      provider: "LOCAL",
      passwordHash: await hashPassword(parsed.data),
      // 관리자는 자기 메일을 스스로 검증할 이유가 없다 — 큐 노출 조건(FR-AUTH-010)은 사업자 신청에만 걸린다
      emailVerifiedAt: new Date(),
      globalRole: "ADMIN",
    })
    .returning({ id: users.id });
  console.log(`✓ ADMIN 생성: ${name} <${parsedEmail.data}> (${row.id})`);
  console.log("  다음: /login 으로 로그인 → /admin 첫 진입에서 TOTP 등록이 강제됩니다");
  await pool.end();
}

/**
 * drizzle 은 pg 오류를 `DrizzleQueryError` 로 감싸고, 원인은 `cause` 에만 있다. 겉 message 는
 * "Failed query: select …" 라 **왜 실패했는지가 통째로 사라진다** — 연결 거부인지 비밀번호인지 표가 없는 건지.
 * `_conn.ts` 의 `describeConnError` 가 그걸 문장으로 바꿔 주므로 원인까지 벗겨서 넘긴다.
 */
function explain(e: unknown): string {
  const chain: unknown[] = [];
  for (let cur: unknown = e; cur && chain.length < 5; cur = (cur as { cause?: unknown }).cause) chain.push(cur);
  const url = process.env.DATABASE_URL ?? "";
  const net = chain.find((x) => {
    const c = (x as { code?: string }).code;
    return x instanceof AggregateError || (c && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "28P01", "3D000", "42P01"].includes(c));
  });
  if (!url) return "DATABASE_URL 이 없다 — .env.local 에 넣거나 앞에 붙여서 실행할 것";
  if (net) {
    const code = (net as { code?: string }).code;
    if (code === "42P01") return "users 표가 없다 — 이 DB 에 마이그레이션이 안 돌았다. `npm run db:migrate` 뒤 다시";
    if (code === "3D000") return "그런 이름의 데이터베이스가 없다 — DATABASE_URL 의 마지막 경로를 확인";
    return describeConnError(net, url);
  }
  return chain.map((x) => (x as Error)?.message).filter(Boolean).join("\n  ← ") || String(e);
}

main().catch((e) => {
  console.error("✗ 실패:", explain(e));
  console.error("  진단: npm run db:status");
  process.exit(1);
});
