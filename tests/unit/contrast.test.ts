import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 명도 대비 회귀 검사 (WCAG 2.1 AA · 01 §10 "색상 대비 WCAG AA (라이트·다크 양쪽)", #85).
 *
 * 토큰을 손볼 때 한쪽 테마만 보고 고치기가 너무 쉽다 — 실제로 라이트 테마의 기본 버튼(흰 글자 / `--primary`)이
 * 3.07 이었고, 다크에서는 7.27 이라 눈으로는 아무 문제가 없어 보였다.
 *
 * **`--border` 는 목록에 없다.** 카드·패널의 장식용 경계라 1.4.11 의 "컴포넌트를 식별하는 데 필요한 시각 정보" 가
 * 아니다. 반대로 버튼·칩·입력의 테두리는 "여기가 컨트롤" 을 알리는 정보라 `--line`(3:1)을 쓴다.
 */
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokensIn(css.slice(css.indexOf(":root {"), css.indexOf("/* 다크 토큰")));
const dark = { ...light, ...tokensIn(css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf("@media (prefers-color-scheme: dark)"))) };

const rgb = (v: string): [number, number, number] => {
  const h = v.replace("#", "");
  const s = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};
const luminance = (c: string): number => {
  const [r, g, b] = rgb(c).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

/** [전경, 배경, 최소치, 무엇에 쓰이는가] — 화면에 실제로 있는 조합만 넣는다 */
const PAIRS: Array<[string, string, number, string]> = [
  ["text", "bg", 4.5, "본문 / 페이지 바탕"],
  ["text", "surface", 4.5, "본문 / 카드"],
  ["text", "surface-2", 4.5, "본문 / 은은한 면"],
  ["text-2", "surface", 4.5, "보조 문구 / 카드"],
  ["text-2", "bg", 4.5, "보조 문구 / 바탕"],
  ["text-2", "surface-2", 4.5, "정책 안내 / 은은한 면"],
  ["text-3", "surface", 4.5, "힌트 · 요일 머리 / 카드"],
  ["text-3", "bg", 4.5, "힌트 / 바탕"],
  ["text-4", "surface", 4.5, "필드 레이블 / 카드"],
  ["on-primary", "primary", 4.5, "기본 버튼 · 선택된 날짜"],
  ["primary-dark", "primary-tint", 4.5, "선택된 칩 · 태그"],
  ["primary-dark", "surface", 4.5, "링크 / 카드"],
  ["bad", "bad-bg", 4.5, "오류 알림"],
  ["ok", "ok-bg", 4.5, "성공 알림"],
  ["warn", "warn-bg", 4.5, "경고 알림"],
  ["bad", "surface", 4.5, "일요일 날짜 · 마감 임박"],
  // UI 컴포넌트·그래픽은 3:1 (WCAG 1.4.11)
  ["line", "surface", 3.0, "버튼 · 칩 · 입력 테두리"],
  ["primary", "surface", 3.0, "포커스 링"],
  ["star", "surface", 3.0, "별점"],
  ["disabled", "bg", 3.0, "비활성 날짜 — 요건 밖이지만 읽히긴 해야 한다"],
];

describe.each([
  ["라이트", light],
  ["다크", dark],
])("명도 대비 (%s)", (_name, tokens) => {
  it.each(PAIRS)("%s / %s ≥ %s — %s", (fg, bg, min) => {
    const f = tokens[fg];
    const b = tokens[bg];
    expect(f, `--${fg} 토큰이 없다`).toBeTruthy();
    expect(b, `--${bg} 토큰이 없다`).toBeTruthy();
    expect(f.startsWith("#") && b.startsWith("#"), "16진수 색이 아니다").toBe(true);
    expect(Number(contrast(f, b).toFixed(2))).toBeGreaterThanOrEqual(min);
  });
});

describe("포커스 링 그림자", () => {
  it("--primary-rgb 는 --primary 와 같은 색이어야 한다", () => {
    // rgba(var(--primary-rgb), .18) 로 쓰이는데 따로 관리되다 보니 조용히 어긋난다
    for (const [name, tokens] of [["라이트", light], ["다크", dark]] as const) {
      expect(tokens["primary-rgb"].split(",").map((x) => Number(x.trim())), name).toEqual(rgb(tokens["primary"]));
    }
  });
});
