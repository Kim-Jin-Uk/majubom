import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, login, publicSlug } from "./helpers";

/**
 * 리뷰 (에픽 #13). 시드의 **지난주 방문 완료 한 건**이 리뷰를 쓸 수 있는 유일한 예약이다 —
 * 나머지 셋은 미래·확정이라 자격이 없다(FR-REV-010 은 `COMPLETED` 만 받는다).
 *
 * 그 한 건을 소비하므로 이 파일의 시나리오들은 **순서대로** 한 줄기다: 쓰고 → 공개 화면에서 보고 →
 * 사장님이 답글을 달고 → 고치고 → 지운다. 나눠 놓으면 서로의 상태를 밟는다.
 */
test.describe.configure({ mode: "serial" });

/**
 * 방문을 마친 그 예약으로 간다. **예약번호로 찾지 않는다** — 코드는 시드가 정하는 값이라
 * 테스트에 박아 두면 시드가 바뀌는 날 조용히 깨진다(실제로 CI 에서 그렇게 깨졌다).
 * 찾는 기준은 이 시나리오가 뜻하는 것 그대로, **상태가 "완료" 인 카드**다.
 */
async function openCompleted(page: Page) {
  await page.goto("/me/reservations");
  await page.getByRole("tab", { name: /지난 예약/ }).click();
  await page.locator("a.myres").filter({ has: page.locator(".myres__badge", { hasText: "완료" }) }).first().click();
}

test.describe("리뷰", () => {
  test("방문을 마친 예약에만 쓸 수 있다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await page.goto("/me/reservations");

    // 다가오는(확정) 예약에는 입구가 없고, 왜인지 말한다
    await page.locator("a.myres").first().click();
    await expect(page.getByText("방문을 마치면 리뷰를 남기실 수 있어요.")).toBeVisible();

    await openCompleted(page);
    await page.getByRole("link", { name: "리뷰 남기기" }).click();

    // 별점 없이는 보낼 수 없다
    await expect(page.getByRole("button", { name: "리뷰 남기기" })).toBeDisabled();
    await page.getByRole("radio", { name: "4점" }).check();
    await page.getByLabel("어떠셨나요?").fill("짧다");
    await expect(page.getByRole("button", { name: "리뷰 남기기" })).toBeDisabled();

    await page.getByLabel("어떠셨나요?").fill("색도 예쁘고 오래가요. 다음에 또 방문할게요.");
    await page.getByRole("button", { name: "리뷰 남기기" }).click();
    await expect(page.getByText("이 방문에 리뷰를 남기셨어요.")).toBeVisible();
  });

  test("가게 페이지에 평균·분포와 함께 뜨고 이름은 가려진다", async ({ page }) => {
    const slug = await publicSlug(page);
    await page.goto(`/@${slug}/reviews`);

    await expect(page.getByText("색도 예쁘고 오래가요. 다음에 또 방문할게요.")).toBeVisible();
    // 사업자는 예약으로 작성자를 특정할 수 있다 — 화면이 실명까지 거들지 않는다 (FR-REV-020)
    await expect(page.getByText("김*객")).toBeVisible();
    await expect(page.getByText("김고객")).toHaveCount(0);

    // 별점 필터는 주소에 남는다 — 공유되는 화면이다
    await page.getByRole("link", { name: /1점/ }).click();
    await expect(page).toHaveURL(/rating=1/);
    await expect(page.getByText("아직 이 조건의 리뷰가 없어요.")).toBeVisible();
    await page.getByRole("link", { name: "전체 보기" }).click();
    await expect(page.getByText("색도 예쁘고 오래가요. 다음에 또 방문할게요.")).toBeVisible();
  });

  test("사장님은 답글만 달 수 있다 — 지우거나 숨기지 못한다", async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto("/console/reviews");

    await expect(page.getByRole("button", { name: /숨기기|리뷰 삭제/ })).toHaveCount(0);
    await page.getByRole("button", { name: "답글 달기" }).click();
    await page.getByLabel("답글").fill("찾아 주셔서 고맙습니다. 다음에도 예쁘게 해 드릴게요!");
    await page.getByRole("button", { name: "답글 저장" }).click();
    // **`.review__reply` 를 본다.** `getByText` 는 열려 있는 입력칸의 글자에도 걸려서,
    // 저장이 실패해도(하이드레이션 전 클릭 등) 통과해 버린다 — 실제로 그렇게 새어 나갔다
    await expect(page.locator(".review__reply")).toContainText("찾아 주셔서 고맙습니다");

    // 손님 화면에도 리뷰 안에 들여쓰여 나타난다
    const slug = await publicSlug(page);
    await page.goto(`/@${slug}/reviews`);
    await expect(page.locator(".review__reply")).toContainText("찾아 주셔서 고맙습니다");
  });

  test("리뷰는 한 번만 고칠 수 있다", async ({ page }) => {
    await login(page, ACCOUNTS.customer);
    await openCompleted(page);
    await page.getByRole("link", { name: "고치기" }).click();
    await expect(page.getByText(/한 번만.*고칠 수 있어요/)).toBeVisible();
    await page.getByLabel("어떠셨나요?").fill("생각보다 더 오래가서 다시 적습니다. 추천해요.");
    await page.getByRole("button", { name: "수정 저장" }).click();

    // 고친 뒤에는 그 입구가 사라진다 — 눌러도 안 되는 링크를 남겨 두지 않는다
    await expect(page.getByText("이 방문에 리뷰를 남기셨어요.")).toBeVisible();
    await expect(page.getByRole("link", { name: "고치기" })).toHaveCount(0);
  });

  test("신고하면 그 자리에서 공개에서 내려간다", async ({ page }) => {
    const slug = await publicSlug(page);
    // 사장님도 손님과 같은 [신고] 를 쓴다 — 숨김 버튼이 없는 이유가 이것이다
    await login(page, ACCOUNTS.owner);
    await page.goto(`/@${slug}/reviews`);

    await page.getByRole("button", { name: "신고" }).click();
    await page.getByLabel("신고 사유").fill("다른 가게 이야기가 섞여 있어요");
    await page.getByRole("button", { name: "신고 보내기" }).click();
    await expect(page.getByText(/신고를 접수했어요/)).toBeVisible();

    // 검토가 끝날 때까지 공개에서 내린다 — 되돌릴 수 있는 쪽으로 기운다
    await page.reload();
    await expect(page.getByText("생각보다 더 오래가서 다시 적습니다. 추천해요.")).toHaveCount(0);
    await expect(page.locator(".review-summary__score b")).toHaveText("—");
  });
});
