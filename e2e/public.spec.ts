import { expect, test } from "@playwright/test";
import { ACCOUNTS, login, publicSlug } from "./helpers";

/**
 * 손님이 보는 쪽 — 검색 메인(#190)부터 가게 홈·예약 위젯까지.
 * 여기서 확인하는 것은 "로그인 없이 둘러볼 수 있는가" 다. 그게 메인을 검색으로 바꾼 이유다.
 */
test.describe("손님", () => {
  test("로그인 없이 메인에서 상품을 찾는다", async ({ page }) => {
    await page.goto("/");
    // 로그인 폼이 아니라 검색이 첫 화면이다
    await expect(page.getByRole("heading", { name: "무엇을 예약할까요?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();

    await expect(page.getByRole("link", { name: /젤네일/ })).toBeVisible();

    // 동네로도 찾는다. **주소에 검색어가 실렸는지 먼저 본다** — 걸러지지 않은 전체 목록에도 젤네일이 있어서,
    // 결과만 보면 검색어를 잃은 채 통과한다(실제로 그런 적이 있다)
    await page.getByLabel("검색어").fill("강남");
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByRole("link", { name: /젤네일/ })).toBeVisible();

    // 없는 말은 빈 결과를 안내한다 — 고장 난 것처럼 보이면 안 된다
    await page.getByLabel("검색어").fill("없는말입니다zzz");
    await page.getByRole("button", { name: "검색" }).click();
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByText(/조건에 맞는 상품이 없어요/)).toBeVisible();
  });

  test("검색 결과에서 바로 예약 단계로 간다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /젤네일/ }).first().click();
    // 가게 홈을 한 번 더 거치지 않는다
    await expect(page).toHaveURL(/\/@[a-z0-9-]+\/book\?product=/);
    await expect(page.getByText("날짜")).toBeVisible();
  });

  test("가게 홈 상단에서 마주,봄으로 돌아간다", async ({ page }) => {
    await page.goto(`/@${await publicSlug(page)}`);
    await expect(page.getByRole("link", { name: "봄 네일" })).toBeVisible();
    await page.getByRole("link", { name: "마주,봄 홈" }).click();
    await expect(page.getByRole("heading", { name: "무엇을 예약할까요?" })).toBeVisible();
  });

  test("내 예약은 로그인해야 보인다", async ({ page }) => {
    await page.goto("/me/reservations");
    await expect(page).toHaveURL(/\/login\?next=%2Fme%2Freservations/);

    await login(page, ACCOUNTS.customer);
    await page.goto("/me/reservations");
    await expect(page.getByRole("heading", { name: "내 예약" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /다가오는 예약/ })).toBeVisible();
  });
});
