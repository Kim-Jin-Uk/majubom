"use client";

type Theme = "light" | "dark";

/** 현재 실제로 적용된 테마. data-theme 이 없으면 OS 설정을 본다. */
function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // 사파리 프라이빗 모드 등 — 저장 못 해도 화면은 바뀐다
  }
}

/**
 * 라이트/다크 토글. 아이콘 전환은 globals.css 의 `.theme-toggle .i-sun/.i-moon` 규칙이
 * 담당하므로 React 상태가 없고, 서버 렌더와 클라이언트 첫 렌더가 항상 같다.
 */
export function ThemeToggle({ size = 38 }: { size?: number }) {
  const inner = size - 20;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="화면 밝기 바꾸기"
      onClick={() => applyTheme(currentTheme() === "dark" ? "light" : "dark")}
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <svg
        className="i-moon"
        width={inner}
        height={inner}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-4)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" />
      </svg>
      <svg
        className="i-sun"
        width={inner}
        height={inner}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-4)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
      </svg>
    </button>
  );
}

export default ThemeToggle;
