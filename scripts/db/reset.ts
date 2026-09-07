/** 1기(W1–W15) 전용. 스키마를 통째로 지우고 마이그레이션을 다시 적용한다. 프로덕션 URL 이면 거부. */
import { execSync } from "node:child_process";
import { ddlClient, assertNotProduction } from "./_conn";

async function main() {
  assertNotProduction();
  const c = await ddlClient();
  try {
    await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await c.query("DROP SCHEMA IF EXISTS drizzle CASCADE;");
    console.log("✓ 스키마 초기화");
  } finally { await c.end(); }
  execSync("npx tsx scripts/db/migrate.ts", { stdio: "inherit" });
}
main().catch((e) => { console.error("✗", e.message ?? e); process.exit(1); });
