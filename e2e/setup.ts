import { expect, test as setup } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers";

/**
 * 시드(`db:seed:test`)는 사업장을 **임시 주소**(`b-…`)로 만든다. 그 상태에서는 공개 홈이 열리지 않으므로
 * (`isInfoComplete`) 손님 시나리오가 전부 404 다. 정식 주소를 정하는 것이 사업자가 실제로 하는 첫 일이라,
 * 준비 단계를 **화면으로** 밟는다 — 이 흐름 자체도 회귀 대상이다.
 *
 * 이미 정식 주소가 있으면 그대로 쓴다. 주소는 30일에 3번만 바꿀 수 있고 옛 주소는 영구 예약되므로,
 * E2E 가 돌 때마다 새 주소를 찍어 대면 안 된다.
 */
setup("공개 주소가 정해져 있어야 가게가 열린다", async ({ page }) => {
  await login(page, ACCOUNTS.owner);
  await page.goto("/console/settings");

  const slugInput = page.getByPlaceholder("my-salon");
  if (!(await slugInput.inputValue())) {
    await slugInput.fill("e2e-shop");
    await page.getByRole("button", { name: "주소 저장" }).click();
    await expect(page.getByText(/공개 주소가 .* 로 정해졌어요/)).toBeVisible();
  }

  // 검색에 걸려야 이후 손님 시나리오가 성립한다
  await page.goto("/");
  await expect(page.locator('a[href^="/@"]').first()).toBeVisible();
});
