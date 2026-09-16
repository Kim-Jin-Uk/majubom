import { expect, test } from "@playwright/test";
import { ACCOUNTS, bookOnce, login, publicSlug } from "./helpers";

/**
 * 고객 마이페이지 (에픽 #12). 손님이 스스로 할 수 있는 일이 여기 다 있다 —
 * 그래서 화면을 여는 것만 보지 않고, 취소가 실제로 상태를 바꾸는 데까지 간다.
 *
 * **시드 예약에 기대되, 쓴 만큼 돌려놓는다.** 손님은 같은 상품을 3건까지만 잡을 수 있어
 * (FR-BIZ-020 `maxActivePerCustomer`) 테스트가 미리 자기 예약을 만들 수 없다. 그래서 취소 시나리오는
 * 시드 한 건을 쓰고 **바로 한 건을 다시 잡아** 개수를 되돌린다 — 안 그러면 로컬에서 두 번째 실행부터
 * 뒤따르는 시나리오가 빈 목록을 만난다(실제로 그랬다).
 * 쓰는 건은 **목록의 마지막**이다 — 앞의 저녁 예약들은 `product-hours.spec.ts` 가 쓴다.
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

    // 쓴 만큼 돌려놓는다. 자리는 방금 취소로 비었다
    await bookOnce(page, await publicSlug(page));
    await page.goto("/me/reservations");
    await expect(page.locator("a.myres")).toHaveCount(before);
  });
});

/**
 * 마이페이지 (#90). 프로필 · 알림 채널 · 설치된 기기가 한 장에 있다.
 */
test.describe("내 정보", () => {
  test("이름을 바꾸면 저장되고 다시 열어도 남아 있다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me");
    const name = page.getByLabel("이름");
    const before = await name.inputValue();
    await name.fill("김고객2");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("저장했어요")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("이름")).toHaveValue("김고객2");
    // 뒤따르는 시나리오가 쓰는 이름이라 되돌려 놓는다
    await page.getByLabel("이름").fill(before);
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("저장했어요")).toBeVisible();
  });

  test("꼭 알아야 하는 알림의 앱 안 채널은 끌 수 없고, 마케팅은 꺼져 있다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me");

    // 예약이 취소됐다는 사실을 알 길이 아예 없어지면 안 된다
    const locked = page.getByLabel("예약 앱 안");
    await expect(locked).toBeChecked();
    await expect(locked).toBeDisabled();

    // 마케팅은 옵트인 — 켜는 것이 사용자의 행동이어야 한다
    // 스위치는 누르는 즉시 저장한다 — 서버 응답으로 상태가 바뀌므로 `check()` 가 아니라 클릭하고 기다린다
    const marketing = page.getByLabel("혜택·소식 메일");
    await expect(marketing).not.toBeChecked();
    await marketing.click();
    await expect(marketing).toBeChecked();

    await page.reload();
    await expect(page.getByLabel("혜택·소식 메일")).toBeChecked();

    // 되돌려 둔다 — 이 시나리오가 남긴 상태가 다음 실행의 첫 단언을 깨뜨리면 안 된다
    await page.getByLabel("혜택·소식 메일").click();
    await expect(page.getByLabel("혜택·소식 메일")).not.toBeChecked();
  });

  test("사업장 구성원이 아니면 근무 알림 줄이 없다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me");
    // 끌 수도 없는 줄을 보여 줄 이유가 없다
    await expect(page.getByLabel("근무 메일")).toHaveCount(0);

    await login(page, ACCOUNTS.manager);
    await page.goto("/me");
    await expect(page.getByLabel("근무 메일")).toBeVisible();
  });
});
