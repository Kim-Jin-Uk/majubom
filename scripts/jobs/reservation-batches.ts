/**
 * 예약 배치 두 개를 한 번에 돌린다 (로컬 확인용). 프로덕션은 Cloud Scheduler → POST /api/cron/{expire-requests,auto-no-show} 로 따로 돈다.
 *   npm run job:reservations
 *     C2 승인 대기 만료 (5분 주기) · C3 노쇼 자동 전환 (일 1회 04:00)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { expireRequests, autoNoShow } = await import("../../src/features/booking/transitions");
  const { pool } = await import("../../src/db/client");
  console.log(`✓ 승인 대기 만료 ${await expireRequests()}건`);
  console.log(`✓ 노쇼 자동 전환 ${await autoNoShow()}건`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗ 배치 실패:", (e as Error).message);
  process.exit(1);
});
