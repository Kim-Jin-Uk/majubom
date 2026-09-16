/**
 * 매시 틱을 로컬에서 한 번 돌린다 (`README.md` 배치 설계).
 *   npm run job:hourly
 *     방문 리마인더 (시작 24시간 전) · 근무 교대 72시간 무응답 만료
 * 프로덕션은 Cloud Scheduler → POST /api/cron/hourly.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { sendReminders } = await import("../../src/features/notification/reminder");
  const { expireSwaps } = await import("../../src/features/schedule/swaps");
  const { pool } = await import("../../src/db/client");
  console.log(`✓ 방문 리마인더 ${await sendReminders()}건`);
  console.log(`✓ 교대 만료 ${await expireSwaps()}건`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗ 배치 실패:", (e as Error).message);
  process.exit(1);
});
