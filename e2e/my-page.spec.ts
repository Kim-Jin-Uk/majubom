import { expect, test } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers";

/**
 * 고객 마이페이지 (에픽 #12). 손님이 스스로 할 수 있는 일이 여기 다 있다 —
 * 그래서 화면을 여는 것만 보지 않고, 취소가 실제로 상태를 바꾸는 데까지 간다.
 *
 * **시드 예약에 기댄다.** 취소 시나리오는 그중 한 건을 소비하는데, 손님은 같은 상품을 3건까지만
 * 잡을 수 있어(FR-BIZ-020 `maxActivePerCustomer`) 테스트가 자기 예약을 새로 만들 수 없다.
 * CI 는 매 실행 새 DB 라 문제가 없고, 로컬에서 반복하려면 `db:reset` → `db:seed:test` 다.
 * 소비하는 건은 **목록의 마지막**이다 — 앞의 저녁 예약들은 `product-hours.spec.ts` 가 쓴다.
 */
test.describe("내 예약", () => {
  test("목록에서 상세로, 상세에 예약번호와 매장 연락처가 있다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/reservations");
    await expect(page.getByRole("tab", { name: /다가오는 예약/ })).toHaveAttribute("aria-selected", "true");

    const first = page.locator("a.myres").first();
    const code = (await first.locator(".myres__code b").innerText()).trim();
    await first.click();

    await expect(page).toHaveURL(/\/me\/reservations\/[0-9a-f-]{36}$/);
    // 손님이 전화로 말할 값 — 목록에서 본 것과 같아야 한다
    await expect(page.locator(".resdt__code")).toHaveText(code);
    await expect(page.getByRole("link", { name: /^0/ })).toBeVisible();
    await expect(page.getByText("진행 이력")).toBeVisible();
  });

  test("남의 예약 id 는 404 — 있는지조차 알려 주지 않는다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    // 형식은 맞지만 남의(없는) id
    await page.goto("/me/reservations/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText(/페이지를 찾을 수 없어요/)).toBeVisible();
  });

  test("시간 변경은 같은 상품으로 위젯에 들어간다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/reservations");
    // 마지막 건을 쓴다 — 가장 가까운 예약은 취소 마감이 이미 지나 변경 링크가 없을 수 있다.
    // 마감이 지나면 변경도 막는 것이 규칙이다(서버가 원 예약을 취소해야 성립하는 흐름이라)
    await page.locator("a.myres").last().click();
    await page.getByRole("link", { name: "시간 변경" }).click();

    // 원 예약 id 를 달고 간다 — 서버가 한 트랜잭션에서 옛 것을 취소하고 새 것을 만든다
    await expect(page).toHaveURL(/replaces=[0-9a-f-]{36}/);
    await expect(page.getByText(/기존 예약은 자동으로 취소됩니다/)).toBeVisible();
    // 변경 중에는 상품을 바꿀 수 없다 — 서버가 같은 상품만 받는다(PRODUCT_MISMATCH)
    await expect(page.getByRole("button", { name: "다른 상품 고르기" })).toHaveCount(0);
  });

  test("취소하면 상태가 바뀌고 지난 탭으로 옮겨 간다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/reservations");
    const before = await page.locator("a.myres").count();
    // 마지막 건을 쓴다 — 앞의 저녁 예약은 영업시간 축소 시나리오가 필요로 한다
    const last = page.locator("a.myres").last();
    const code = (await last.locator(".myres__code b").innerText()).trim();
    await last.click();

    await page.getByRole("button", { name: "예약 취소" }).click();
    // 한 번 더 묻는다 — 되돌릴 수 없는 일이다
    await expect(page.getByText(/같은 시각이 다시 비어 있다는 보장은 없어요/)).toBeVisible();
    await page.getByRole("button", { name: "예약 취소" }).click();

    // 배지와 진행 이력 둘 다 바뀐다 — 이력에 남는 것이 이 화면의 절반이다
    await expect(page.locator(".myres__badge")).toHaveText("고객 취소");
    await expect(page.locator(".resdt__log")).toContainText("고객 취소");

    await page.goto("/me/reservations");
    await expect(page.locator("a.myres")).toHaveCount(before - 1);
    await page.getByRole("tab", { name: /지난 예약/ }).click();
    await expect(page.locator("a.myres", { hasText: code })).toBeVisible();
  });
});
