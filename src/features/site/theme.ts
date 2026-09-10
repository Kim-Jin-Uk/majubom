import type { SiteColorScheme, SiteTheme } from "@/db/schema";

/**
 * 공개 홈의 밝기 (#76 · 01 §10 "공개 페이지는 사업자가 라이트/다크/자동 중 선택").
 *
 * 값은 세 겹으로 정해진다. 아래로 갈수록 세다.
 *   1) 없음        → 라이트 (globals.css 의 `:root` 기본 토큰)
 *   2) 사업자 선택 → LIGHT / DARK 는 `data-theme` 를 박고, AUTO 는 안 박아서 OS 설정에 맡긴다
 *   3) 손님 토글   → localStorage `site-theme`. **사업자 선택을 이긴다** — 밝기는 취향이 아니라
 *                    눈의 문제라 보는 사람이 마지막 말을 한다. 그래서 토글이 헤더에 있는 것이다
 *
 * 콘솔의 토글은 열쇠가 다르다(`theme`). 같이 쓰면 사장님이 콘솔을 어둡게 해 둔 것이
 * 자기 가게 홈을 어둡게 만들고, 손님이 남의 가게에서 누른 것이 우리 콘솔을 바꾼다.
 *
 * 이 파일은 순수하다 — DB 도 React 도 모른다.
 */

export const SITE_COLOR_SCHEMES = ["AUTO", "LIGHT", "DARK"] as const;

export const DEFAULT_COLOR_SCHEME: SiteColorScheme = "AUTO";

/** 손님 토글이 쓰는 localStorage 열쇠. 콘솔(`theme`)과 일부러 다르다 */
export const SITE_THEME_KEY = "site-theme";

export const DEFAULT_SITE_THEME: Required<SiteTheme> = {
  primaryColor: "#14a86b",
  fontScale: 1,
  radius: 12,
  containerWidth: 1080,
  colorScheme: DEFAULT_COLOR_SCHEME,
};

/** jsonb 에서 온 값은 무엇이든 될 수 있다. 아는 셋이 아니면 기본값 */
export function normalizeColorScheme(v: unknown): SiteColorScheme {
  return (SITE_COLOR_SCHEMES as readonly string[]).includes(v as string) ? (v as SiteColorScheme) : DEFAULT_COLOR_SCHEME;
}

/** `<html data-theme>` 에 박을 값. AUTO 는 **안 박는다** — 박으면 OS 설정을 덮어쓴다 */
export function themeAttr(scheme: SiteColorScheme): "light" | "dark" | null {
  return scheme === "LIGHT" ? "light" : scheme === "DARK" ? "dark" : null;
}

/**
 * 첫 페인트 전에 밝기를 확정하는 인라인 스크립트.
 *
 * `<html>` 은 루트 레이아웃이 들고 있어서 이 페이지가 서버에서 속성을 박을 수 없다. 감싸는 div 에
 * `data-theme` 를 걸면 토큰은 바뀌지만 `body` 의 배경은 루트 값 그대로라 스크롤 끝에서 반대 색이 비친다.
 * 그래서 문서 파싱 도중(= 페인트 전) 도는 인라인 스크립트로 `<html>` 에 직접 건다.
 *
 * **`removeAttribute` 가 있는 이유**: 루트 레이아웃의 초기화 스크립트가 먼저 돌아 콘솔용 `theme` 을
 * 이미 박아 뒀을 수 있다. 사업자가 AUTO 를 골랐으면 그것까지 걷어내야 OS 설정이 산다.
 *
 * 넣는 값은 "light" | "dark" | "" 셋뿐이라 문자열 주입이 성립하지 않는다.
 */
export function themeInitScript(scheme: SiteColorScheme): string {
  const attr = themeAttr(scheme) ?? "";
  return `(function(){var b="${attr}",d=document.documentElement,v="";try{v=localStorage.getItem(${JSON.stringify(SITE_THEME_KEY)})||""}catch(e){}if(v!=="light"&&v!=="dark")v=b;if(v){d.setAttribute("data-theme",v)}else{d.removeAttribute("data-theme")}})();`;
}

export const COLOR_SCHEME_LABELS: Record<SiteColorScheme, { label: string; hint: string }> = {
  AUTO: { label: "자동", hint: "손님 기기의 밝기 설정을 따라갑니다" },
  LIGHT: { label: "라이트", hint: "언제나 밝은 화면" },
  DARK: { label: "다크", hint: "언제나 어두운 화면" },
};
