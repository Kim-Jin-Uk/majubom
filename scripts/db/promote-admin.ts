/**
 * 사용자를 ADMIN 으로 승격한다 (관리자 셀프 가입 UI 는 없다 — FR-ADM 은 운영자 1인 전제).
 *   npm run admin:promote -- someone@example.com
 * 승격 직후 첫 /admin 진입에서 TOTP 등록이 강제된다 (FR-AUTH-030).
 */
import { config as loadEnv } from "dotenv";
import { describeConnError } from "./_conn";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("사용법: npm run admin:promote -- <email>");
    process.exit(2);
  }
  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../../src/db/client");
  const { users } = await import("../../src/db/schema");
  const rows = await db.update(users).set({ globalRole: "ADMIN" }).where(eq(users.email, email)).returning({ id: users.id, name: users.name });
  if (rows.length === 0) console.error(`✗ 사용자 없음: ${email}`);
  else console.log(`✓ ADMIN 승격: ${rows[0].name} (${rows[0].id})`);
  await pool.end();
  process.exit(rows.length === 0 ? 1 : 0);
}

main().catch((e) => {
  // drizzle 은 원인을 cause 에만 담는다 — 겉 message 는 "Failed query: …" 라 이유가 사라진다
  const cause = (e as { cause?: unknown }).cause;
  console.error("✗ 실패:", describeConnError(cause ?? e, process.env.DATABASE_URL ?? ""));
  console.error("  진단: npm run db:status");
  process.exit(1);
});
