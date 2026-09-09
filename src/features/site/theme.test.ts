import { describe, expect, it } from "vitest";
import { DEFAULT_COLOR_SCHEME, SITE_THEME_KEY, normalizeColorScheme, themeAttr, themeInitScript } from "./theme";

describe("normalizeColorScheme", () => {
  it("아는 셋만 통과하고 나머지는 기본값", () => {
    expect(normalizeColorScheme("DARK")).toBe("DARK");
    expect(normalizeColorScheme("LIGHT")).toBe("LIGHT");
    expect(normalizeColorScheme("AUTO")).toBe("AUTO");
    // jsonb 에서 오는 값은 무엇이든 될 수 있다 — 키가 없던 옛 행, 오타, 소문자
    for (const v of [null, undefined, "", "dark", "Dark", 1, {}, ["DARK"]]) expect(normalizeColorScheme(v)).toBe(DEFAULT_COLOR_SCHEME);
  });
});

describe("themeAttr", () => {
  it("AUTO 는 속성을 박지 않는다 — 박으면 OS 설정을 덮어쓴다", () => {
    expect(themeAttr("AUTO")).toBeNull();
    expect(themeAttr("LIGHT")).toBe("light");
    expect(themeAttr("DARK")).toBe("dark");
  });
});

/** 스크립트를 실제로 돌려 본다. `<html>` 대역으로 최소한의 document 를 세운다 */
function run(script: string, stored: string | null, initialAttr?: string) {
  const attrs = new Map<string, string>();
  if (initialAttr) attrs.set("data-theme", initialAttr);
  const d = {
    documentElement: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    },
  };
  const ls = {
    getItem: (k: string) => {
      if (stored === "THROW") throw new Error("사파리 프라이빗 모드");
      return k === SITE_THEME_KEY ? stored : null;
    },
  };
  new Function("document", "localStorage", script)(d, ls);
  return attrs.get("data-theme") ?? null;
}

describe("themeInitScript", () => {
  it("사업자 선택이 기본값이다", () => {
    expect(run(themeInitScript("DARK"), null)).toBe("dark");
    expect(run(themeInitScript("LIGHT"), null)).toBe("light");
    expect(run(themeInitScript("AUTO"), null)).toBeNull();
  });

  it("손님 토글이 사업자 선택을 이긴다 — 밝기는 보는 사람이 마지막 말을 한다", () => {
    expect(run(themeInitScript("DARK"), "light")).toBe("light");
    expect(run(themeInitScript("LIGHT"), "dark")).toBe("dark");
  });

  it("AUTO 면 루트 레이아웃이 콘솔용으로 박아 둔 값까지 걷어낸다", () => {
    // 사장님이 콘솔을 어둡게 해 두면 layout.tsx 의 초기화가 data-theme="dark" 를 먼저 박는다.
    // 그대로 두면 AUTO 를 고른 가게가 사장님 눈에만 어둡게 보인다
    expect(run(themeInitScript("AUTO"), null, "dark")).toBeNull();
  });

  it("localStorage 가 막혀 있어도 사업자 선택은 적용된다", () => {
    expect(run(themeInitScript("DARK"), "THROW")).toBe("dark");
  });

  it("저장된 값이 아는 둘이 아니면 무시한다", () => {
    expect(run(themeInitScript("LIGHT"), "AUTO")).toBe("light");
    expect(run(themeInitScript("DARK"), "쓰레기")).toBe("dark");
  });
});
