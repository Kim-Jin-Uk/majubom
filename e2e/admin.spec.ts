import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * 관리자 콘솔 — 로컬·CI 에서는 TOTP 를 건너뛴다(`AUTH_DEV_SKIP_TOTP`). 인증 앱을 붙일 수 없어서다.
 * **프로덕션에서는 이 플래그가 부팅을 막는다** — 그 잠금은 유닛 테스트(`dev-flags.test.ts`)가 본다.
 */
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";

test.describe("관리자", () => {
  test("ADMIN 이 아니면 /admin 은 404 — 로그인은 로그인으로 보낸다", async ({ page }) => {
    // 비로그인: 다른 보호 경로와 똑같이 로그인으로
    await page.context().clearCookies();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

    // 로그인했지만 ADMIN 이 아니면 존재를 알리지 않는다
    await login(page, "owner@example.com");
    await page.goto("/admin");
    await expect(page.getByText(/페이지를 찾을 수 없어요/)).toBeVisible();
  });

  test("TOTP 없이 관리자 콘솔에 들어간다 (로컬 전용 스위치)", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin");
    // TOTP 등록 화면으로 튕기지 않는다
    await expect(page).not.toHaveURL(/\/login\/totp/);
    // 홈은 지표 대시보드다. 집계 쿼리가 여럿이라 이 한 줄이 그 전부를 실제 DB 에 태워 본다
    await expect(page.getByRole("heading", { name: "서비스 지표" })).toBeVisible();
    await expect(page.getByText("일별 예약 추이 (30일)")).toBeVisible();
    await expect(page.getByText("품질 지표 (이번 달)")).toBeVisible();

    await page.goto("/admin/businesses");
    await expect(page.getByText("봄 네일")).toBeVisible();
  });
});
