/** 로그인 후 복귀 경로 — 같은 출처의 절대 경로만 허용한다 (오픈 리다이렉트 방지). 기본 "/" */
export function safeNext(raw: string | undefined | null, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw;
}

/**
 * 로그인·가입 직후에는 router.push 대신 전체 내비게이션을 쓴다 — 새 세션 쿠키로 프록시(갱신·접근 제어)와 RSC 를
 * 처음부터 다시 태우는 가장 확실한 방법이다. 클라이언트 전용.
 */
export function hardNavigate(path: string): void {
  window.location.assign(new URL(path, window.location.origin).toString());
}
