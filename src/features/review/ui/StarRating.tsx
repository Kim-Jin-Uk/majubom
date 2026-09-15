"use client";

/**
 * 별점 입력·표시. **라디오 그룹이다** — 별 다섯 개를 버튼으로 만들면 키보드로 하나씩 탭해야 하고,
 * 스크린리더에는 "버튼 1, 버튼 2 …" 로 읽힌다. 라디오면 방향키로 고르고 "3점" 으로 읽힌다.
 */
export function StarInput({ value, onChange, name = "rating" }: { value: number; onChange: (n: number) => void; name?: string }) {
  return (
    <span className="stars stars--input" role="radiogroup" aria-label="별점">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={`star${n <= value ? " on" : ""}`}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} aria-label={`${n}점`} />
          <span aria-hidden="true">★</span>
        </label>
      ))}
    </span>
  );
}

/** 읽기 전용 별점. 숫자도 같이 낸다 — 별만 있으면 4점과 5점이 흘깃 봐서 구분되지 않는다 */
export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value}점`}>
      <span aria-hidden="true">{"★".repeat(value)}{"☆".repeat(5 - value)}</span>
    </span>
  );
}
