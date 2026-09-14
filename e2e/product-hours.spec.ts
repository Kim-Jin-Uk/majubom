import { expect, test } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers";

/**
 * 상품별 예약 가능 시간(#196) — **기본이 "영업시간과 동일"(연동)** 이라는 것과,
 * 시간을 줄여 기존 예약이 밖으로 나가면 막힌다는 것.
 */
test.describe("예약 가능 시간", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ACCOUNTS.owner);
  });

  test("상품은 기본으로 영업시간을 따르고, 끄면 그 값으로 채워진다", async ({ page }) => {
    await page.goto("/console/products");
    await page.getByRole("link", { name: "수정" }).first().click();

    const toggle = page.getByLabel("영업시간과 동일");
    await expect(toggle).toBeChecked();
    await expect(page.getByText(/영업시간을 바꾸면 이 상품도 같이 바뀝니다/)).toBeVisible();

    // 끄면 사업장 영업시간이 시작점으로 들어온다 — 빈 표에서 일곱 요일을 다시 찍게 두지 않는다
    await toggle.uncheck();
    await expect(page.getByLabel("상품 월요일 시작")).toHaveValue("10:00");
  });

  test("영업시간을 줄여 예약이 밖으로 나가면 막고, 무엇이 걸리는지 보여 준다", async ({ page }) => {
    await page.goto("/console/settings");
    // 마감을 앞으로 당긴다 — 앞으로의 예약(저녁)이 밖으로 나간다.
    // 휴게(13–14)보다 이르게 당기면 "휴게는 영업시간 안에" 라는 **형식 검증**에 먼저 걸려
    // 정작 보려는 예약 충돌까지 가지 못한다. 그래서 15:00 로 둔다
    for (const dow of ["월", "화", "수", "목", "금"]) {
      const close = page.getByLabel(`영업 ${dow}요일 마감`);
      if (await close.isVisible().catch(() => false)) await close.fill("15:00");
    }
    await page.getByRole("button", { name: "저장", exact: true }).first().click();

    await expect(page.getByText(/그 시간 밖으로 나갑니다/)).toBeVisible();
    // 예약번호까지 보여 줘야 사장님이 무엇을 정리할지 안다
    await expect(page.locator("text=/\\([A-Z0-9]{8}\\)/").first()).toBeVisible();
  });
});
