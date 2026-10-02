import { expect, test } from "@playwright/test";
import { ACCOUNTS, bookOnce, login, publicSlug } from "./helpers";

/**
 * 알림 (에픽 #14). 알림은 **조용히 사라지는 것이 가장 무서운 기능**이다 —
 * 아무도 오류를 보지 못하고, 손님은 예약이 확정된 줄 모른 채 안 온다.
 * 그래서 화면을 여는 데서 그치지 않고 **예약을 실제로 잡아** 한 줄이 쌓이는 것부터 본다.
 *
 * **자리를 스스로 만든다.** 손님은 같은 상품을 3건까지만 잡을 수 있어(`maxActivePerCustomer`) 시드 상태에서는
 * 새로 잡을 수 없다. 그래서 한 건을 먼저 취소하고 잡는다 — 취소는 알림을 만들지 않으므로
 * (매장이 콘솔에서 이미 보는 일이다) 이 시나리오가 세는 알림을 어지럽히지도 않는다. 개수도 그대로다.
 */
test.describe.configure({ mode: "serial" });

test.describe("알림", () => {
  let code = "";
  /** 첫 시나리오가 자리를 만들려고 취소한 예약 — 그 취소는 매장에 알려져야 한다 */
  let canceled = "";

  test("예약을 잡으면 손님 알림함에 쌓이고 배지가 오른다", async ({ page }) => {
    const slug = await publicSlug(page);
    await login(page, ACCOUNTS.customer);

    // 자리를 만든다 — 한도가 3건이라 시드 상태에서는 새로 잡을 수 없다
    await page.goto("/me/reservations");
    await page.locator("a.myres").last().click();
    canceled = (await page.locator(".resdt__code").innerText()).trim();
    await page.getByRole("button", { name: "예약 취소" }).click();
    await page.getByRole("button", { name: "예약 취소" }).click();
    await expect(page.locator(".myres__badge")).toHaveText("고객 취소");

    code = await bookOnce(page, slug);

    await page.goto("/me/notifications");
    const row = page.locator(".noti", { hasText: code });
    await expect(row).toBeVisible();
    // 안 읽은 줄은 배경으로 구분한다 — 점 하나로는 목록에서 훑을 때 안 보인다
    await expect(row).toHaveClass(/unread/);
    await expect(page.locator(".bell__dot")).toBeVisible();
  });

  test("누르면 그 예약으로 가고 읽음이 남는다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/notifications");
    await page.locator(".noti", { hasText: code }).click();

    // 딥링크가 실제로 그 예약 상세다
    await expect(page).toHaveURL(/\/me\/reservations\/[0-9a-f-]{36}$/);
    await expect(page.locator(".resdt__code")).toHaveText(code);

    // 낙관적 표시가 아니라 실제로 저장됐다 — 새로 열어도 읽은 채다
    await page.goto("/me/notifications");
    await expect(page.locator(".noti", { hasText: code })).not.toHaveClass(/unread/);
  });

  test("모두 읽음을 누르면 배지가 사라진다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/notifications");
    const button = page.getByRole("button", { name: /모두 읽음/ });
    if (await button.isVisible().catch(() => false)) await button.click();

    await expect(page.locator(".noti.unread")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".bell__dot")).toHaveCount(0);
  });

  test("매장에는 새 요청만 온다 — 매장이 한 일을 매장에 다시 알리지 않는다", async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto("/console/notifications");
    await expect(page.getByRole("heading", { name: "알림" })).toBeVisible();

    /**
     * 시드 사업장은 자동 승인이라 손님의 예약이 바로 `CONFIRMED` 로 생긴다 —
     * 그건 매장이 이미 아는 일이므로 매장 알림함에 줄이 생기지 않는 것이 맞다.
     * (승인 대기로 들어오는 건은 `RESERVATION_REQUESTED` 로 매장에 간다.)
     */
    await expect(page.locator(".noti", { hasText: code })).toHaveCount(0);

    /**
     * **손님 취소는 온다.** 손님에게는 메일도 알림도 없지만(스스로 한 일이다) 매장은 알아야 한다 —
     * 그 자리가 다시 비었다는 뜻이라, 늦게 알수록 못 파는 시간이 길어진다 (FR-NOTI-010).
     */
    await expect(page.locator(".noti", { hasText: canceled })).toBeVisible();
  });
});
