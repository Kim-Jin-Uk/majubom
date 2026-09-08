/**
 * 실 DB 마이그레이션 러너.
 *  - 직결(unpooled) 연결 · lock_timeout 3s · statement_timeout 60s  (08 §5.5)
 *  - 락을 못 잡으면(55P03) 지수 백오프로 최대 5회 재시도. 큐를 만드는 것보다 물러나는 게 낫다
 *  - Drizzle migrator 는 마이그레이션 파일 단위 트랜잭션. enum 값 추가는 별도 파일로 (08 §5.2 정정 3)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ddlClient } from "./_conn";

const MAX = 5;
async function main() {
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const client = await ddlClient();
    try {
      const db = drizzle(client);
      const t0 = Date.now();
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log(`✓ migrate 완료 (${Date.now() - t0}ms)`);
      return;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const lockFail = err.code === "55P03" || /lock timeout/i.test(err.message ?? "");
      if (lockFail && attempt < MAX) {
        const wait = 1000 * 2 ** (attempt - 1);
        console.warn(`! 락 획득 실패 (${attempt}/${MAX}) — ${wait}ms 후 재시도`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    } finally {
      await client.end();
    }
  }
}
main().catch((e: unknown) => {
  const err = e as { message?: string; code?: string; errors?: unknown[] };
  const detail = err?.message || (Array.isArray(err?.errors) ? err.errors.map((x) => (x as Error).message).join("; ") : String(e));
  console.error(`✗ migrate 실패${err?.code ? ` [${err.code}]` : ""}: ${detail}`);
  process.exit(1);
});
