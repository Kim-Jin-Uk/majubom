/**
 * 야간 틱을 로컬에서 한 번 돌린다 (`README.md` 배치 설계).
 *   npm run job:nightly
 *     30일 지난 알림 정리
 * 프로덕션은 Cloud Scheduler → POST /api/cron/nightly (03:00 KST).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { purgeOldNotifications } = await import("../../src/features/notification/inbox");
  const { pool } = await import("../../src/db/client");
  console.log(`✓ 알림 정리 ${await purgeOldNotifications()}건`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗ 배치 실패:", (e as Error).message);
  process.exit(1);
});
