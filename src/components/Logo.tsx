import type { CSSProperties } from "react";

type LogoProps = {
  /** 마크 한 변의 픽셀 크기. 워드마크 글자 크기는 이 값에 비례한다. */
  size?: number;
  /** 워드마크 "마주,봄" 표시 여부 */
  withText?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * 마주,봄 로고. 원본: reservation-design/_build.py `logo()`.
 * 두 사람(人, ㅏ/ㅓ 대칭)과 그 사이 쉼표 모양 꽃눈(bloom).
 * 색은 토큰만 쓴다 — 다크 모드에서 알아서 바뀐다.
 */
export function Logo({ size = 22, withText = true, className, style }: LogoProps) {
  const wordSize = Math.round(size * (21 / 22));
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.36), ...style }}
      aria-label="마주,봄"
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* 왼쪽 사람 — 긴 획은 곧게 내려오고 바깥쪽 다리만 중간에서 짧게 갈라진다 (ㅏ) */}
        <path d="M7.9 3.6C8.2 8.8 8.4 13.9 8.7 19" stroke="var(--primary)" strokeWidth="2.4" />
        <path d="M8.15 8.9C7.0 10.6 5.8 12.2 4.6 13.7" stroke="var(--primary)" strokeWidth="2.4" />
        {/* 오른쪽 사람 — 좌우 대칭 (ㅓ) */}
        <path d="M16.1 3.6C15.8 8.8 15.6 13.9 15.3 19" stroke="var(--primary)" strokeWidth="2.4" />
        <path d="M15.85 8.9C17.0 10.6 18.2 12.2 19.4 13.7" stroke="var(--primary)" strokeWidth="2.4" />
        {/* 두 사람 사이 쉼표 꽃눈 */}
        <circle cx="12" cy="8.2" r="2.3" fill="var(--bloom)" />
        <path d="M12.95 10.3c.2 2-.6 3.4-2.15 4.2" stroke="var(--bloom)" strokeWidth="1.8" />
      </svg>
      {withText && (
        <span
          style={{
            fontSize: wordSize,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            lineHeight: 1,
          }}
        >
          마주<span style={{ color: "var(--bloom)" }}>,</span>봄
        </span>
      )}
    </span>
  );
}

export default Logo;
