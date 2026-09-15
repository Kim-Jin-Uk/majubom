import { expect, type Page } from "@playwright/test";

/** 시드가 만드는 계정 (`npm run db:seed:test`). 비밀번호는 전부 같다 */
export const ACCOUNTS = {
  owner: "owner@example.com",
  manager: "manager@example.com",
  customer: "customer@example.com",
} as const;
export const PASSWORD = "test1234";

/**
 * 로그인. **화면을 통해서** 한다 — 쿠키를 심으면 로그인 흐름 자체가 회귀해도 E2E 가 눈치채지 못한다.
 * 이미 로그인돼 있으면 로그아웃부터 한다(시나리오마다 다른 사람으로 들어온다).
 */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/");
  const logout = page.getByRole("button", { name: "로그아웃" });
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
    await expect(page.getByRole("link", { name: "로그인" })).toBeVisible();
  }
  await page.goto("/login");
  // 하이드레이션 전에 누르면 폼이 **네이티브 GET** 으로 제출돼 `/login?` 으로 되돌아온다 (입력도 날아간다).
  // 그 경우를 한 번 더 시도해서 넘긴다 — 대기 시간을 늘리는 것보다 조건을 보고 다시 하는 쪽이 덜 흔들린다.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 8_000 });
      return;
    } catch {
      // 아직 /login 이다. 오류 문구가 있으면 진짜 실패이므로 더 시도하지 않는다
      const alert = page.locator(".alert--error");
      if (await alert.isVisible().catch(() => false)) throw new Error(`로그인 실패: ${await alert.innerText()}`);
    }
  }
  throw new Error(`로그인이 끝나지 않았다 (${email})`);
}

/**
 * 공개 사업장의 주소. **검색 결과 링크에서 읽는다** — 로그인 없이 되고, 그 자체가 "검색이 가게로 연결된다" 는 확인이다.
 * 시드는 임시 주소(`b-…`)로 시작하므로 `setup.ts` 가 먼저 정식 주소를 정해 둔다.
 */
export async function publicSlug(page: Page): Promise<string> {
  await page.goto("/");
  const href = await page.locator('a[href^="/@"]').first().getAttribute("href");
  const m = href?.match(/^\/@([a-z0-9-]+)/);
  if (!m) throw new Error("공개된 가게를 찾지 못했다 — 시드가 임시 주소 상태이거나 공개 조건을 못 갖췄다");
  return m[1];
}

