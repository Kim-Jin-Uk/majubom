// Firestore 보안 규칙 테스트 — 에뮬레이터 안에서만 돈다.
//   npx firebase emulators:exec --only firestore --project demo-majubom "npm run test:rules"
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
