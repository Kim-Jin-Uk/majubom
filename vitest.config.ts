import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // tests/db 는 실제 Postgres 가 있을 때만 도는 회귀 테스트다 (파일 안에서 skipIf 로 판단한다)
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    environment: "node",
    // 동시성 테스트가 수십 트랜잭션을 동시에 연다 — 기본 풀(5)이면 커넥션 대기가 타임아웃으로 번져 플래키해진다
    env: { DB_POOL_MAX: "30" },
    globals: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
