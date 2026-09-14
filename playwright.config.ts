import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — **화면을 통해서만** 확인한다. DB 를 직접 읽지 않는다.
 *
 * 유닛·DB 테스트가 이미 규칙을 촘촘히 본다(`npm test`). 여기서 보는 것은 그 규칙들이 **한 화면에 붙어 실제로
 * 손님·사장님이 할 수 있는 일이 되는가**다 — 그래서 시나리오가 적고, 대신 각각이 끝까지 간다.
 *
 * 서버는 `next dev` 로 띄운다. `next build` 는 CI 에서 몇 분을 먹는데, E2E 가 보는 것은 빌드 산출물이 아니라 흐름이다.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
// `127.0.0.1` 이 아니라 `localhost` 다 — Next dev 가 그 둘을 다른 출처로 보고 HMR·요청을 막는다
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // 같은 DB 한 벌을 공유한다 — 시나리오가 서로의 데이터를 건드리므로 병렬로 돌리지 않는다
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // 시드는 임시 주소(b-…) 상태라 공개 홈이 열리지 않는다 — 준비 단계가 먼저 정식 주소를 정한다
    { name: "setup", testMatch: /setup\.ts$/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // 개발 서버와 같은 `.next` 를 쓰면 `next dev` 의 잠금에 걸린다 — E2E 는 제 디렉터리를 쓴다
      NEXT_DIST_DIR: ".next-e2e",
      // 1기 게이트를 끄지 않으면 Basic Auth·noindex 가 끼어든다
      GATE_ENABLED: "false",
      // 인증 앱을 붙일 수 없으므로 ADMIN 2단계를 건너뛴다 (프로덕션에서는 부팅이 막힌다 — `lib/env.ts`)
      AUTH_DEV_SKIP_TOTP: "true",
      AUTH_URL: baseURL,
    },
  },
});
