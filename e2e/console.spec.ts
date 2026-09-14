import { expect, test } from "@playwright/test";
import { ACCOUNTS, login, publicSlug } from "./helpers";

/**
 * 사업자 콘솔 — 이번 작업에서 **화면이 침묵하던 자리들**을 본다.
 * 버튼이 이유 없이 잠기거나(주소 저장), 규칙이 바뀌었는데 안내가 옛말을 하던 것들이다.
 */
test.describe("사업자", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ACCOUNTS.owner);
  });

  test("주소 저장이 왜 막히는지 말해 준다", async ({ page }) => {
    await page.goto("/console/settings");
    const input = page.getByPlaceholder("my-salon");
    const save = page.getByRole("button", { name: "주소 저장" });

    // 지금 쓰는 주소를 그대로 적으면 — 조용히 잠기지 않고 이유를 말한다
    const slug = await publicSlug(page);
    await page.goto("/console/settings");
    await input.fill(slug);
    await expect(page.getByText("지금 쓰는 주소예요")).toBeVisible();
    await expect(save).toBeDisabled();

    // 임시 주소 형식은 새 주소로 쓸 수 없다
    await input.fill("b-nope");
    await expect(page.getByText(/임시 주소 전용/)).toBeVisible();
    await expect(save).toBeDisabled();

    // 예약어
    await input.fill("admin");
    await expect(page.getByText("이미 예약된 주소예요")).toBeVisible();
  });

  test("영업시간 빠른 설정이 켜 둔 요일에만 적용된다", async ({ page }) => {
    await page.goto("/console/settings");
    await page.getByRole("button", { name: "평일 10–19 · 주말 휴무" }).click();
    await expect(page.getByLabel("영업 월요일 시작")).toHaveValue("10:00");
    await expect(page.getByLabel("영업 월요일 마감")).toHaveValue("19:00");
    // 주말은 꺼진다 — 시간 칸 자체가 사라진다
    await expect(page.getByLabel("영업 일요일 시작")).toHaveCount(0);
  });

  test("영업시간을 정하지 않으면 승인 대기로 받는다고 알려 준다", async ({ page }) => {
    await page.goto("/console/settings");
    await page.getByRole("button", { name: "모두 끄기" }).click();
    await expect(page.getByText(/항상 승인 대기/)).toBeVisible();
    // 저장하지 않고 떠난다 — 다른 시나리오가 영업시간에 기대고 있다
  });

  test("자원 목록이 담당자와 공간으로 나뉜다", async ({ page }) => {
    await page.goto("/console/resources");
    // h1("담당자 · 공간")과 구분해야 한다 — 보려는 것은 **종류별 섹션 제목**이다
    await expect(page.locator(".res-group", { hasText: "담당자" })).toBeVisible();
    await expect(page.locator(".res-group", { hasText: "공간" })).toBeVisible();
  });

  test("근무 교대는 왜 못 하는지 말해 준다", async ({ page }) => {
    await page.goto("/console/schedule/swaps");
    // 요청 → 수락 → 승인 순서가 화면에 있다
    await expect(page.getByText(/사장님이.*승인/)).toBeVisible();
    // 사장님은 담당자 자원이 없어 요청할 수 없다 — 그 이유가 뜬다
    await expect(page.getByText(/담당자 자원이 연결된 계정만/)).toBeVisible();
  });
});
