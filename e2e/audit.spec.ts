import { expect, test } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers";

/**
 * 감사 로그 조회 (#68). **적재와 조회를 한 시나리오로 잇는다** — 조회 화면만 열어 보면
 * "빈 목록이 잘 그려진다" 밖에 확인되지 않는다. 사업자가 실제로 한 변경이 운영자 화면에 나타나야 뜻이 있다.
 */
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";

test("사업자가 바꾼 것이 운영자의 감사 로그에 남는다", async ({ page }) => {
  // 1) 사업자가 공개 홈 밝기를 바꾼다 — 지금 값과 다른 쪽을 고른다(같은 값이면 서버가 아무것도 쓰지 않는다)
  await login(page, ACCOUNTS.owner);
  await page.goto("/console/settings");
  // 설정 화면에는 저장 버튼이 여럿이다 — 밝기 패널 안에서만 찾는다
  const theme = page.locator("section.panel", { hasText: "홈페이지 밝기" });
  const dark = theme.getByRole("radio", { name: /다크/ });
  const light = theme.getByRole("radio", { name: /라이트/ });
  await ((await dark.isChecked()) ? light : dark).check();
  await theme.getByRole("button", { name: "저장", exact: true }).click();
  await expect(theme.getByText("저장했습니다")).toBeVisible();

  // 2) 운영자가 그 변경을 본다
  await login(page, ADMIN);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "감사 로그" })).toBeVisible();

  const row = page.getByRole("button", { name: /사업장 정보 변경/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  // 무엇이 무엇으로 바뀌었는지가 펼쳐진다
  await expect(page.getByText("siteColorScheme")).toBeVisible();
});

test("기간으로 좁히면 API 를 다시 읽는다", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/admin/audit");
  // 아직 오지 않은 날짜 — 무엇이 쌓여 있든 결과가 없어야 한다
  await page.getByLabel("시작일").fill("2099-01-01");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.getByText("조건에 맞는 기록이 없어요.")).toBeVisible();
});
