/**
 * 미검증 사업자 신청 정리 (FR-AUTH-010). 프로덕션은 Cloud Scheduler → POST /api/cron/cleanup-unverified.
 *   npm run job:cleanup-unverified
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { cleanupUnverifiedBusinesses } = await import("../../src/features/auth/business-signup");
  const { pool } = await import("../../src/db/client");
  const n = await cleanupUnverifiedBusinesses();
  console.log(`✓ 미검증 사업자 신청 ${n}건 삭제`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗ 정리 실패:", (e as Error).message);
  process.exit(1);
});
