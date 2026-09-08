/**
 * 인증 상수 (FR-AUTH-030 "세션 · 인증 정책", FR-AUTH-010/020/040).
 * 숫자를 바꾸면 명세와 README 의 표도 같이 바꾼다.
 */
export const ACCESS_TTL_SEC = 15 * 60; // 액세스(JWT 스냅샷) 15분 — 지나면 프록시가 리프레시 토큰으로 갱신
export const REFRESH_TTL_SEC = 30 * 24 * 3600; // 리프레시 30일 (고객·콘솔 동일). 절대 만료 — 연장되지 않는다
export const ROTATION_GRACE_SEC = 60; // 회전 직전 토큰을 받아주는 유예 (동시 탭)

export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const EMAIL_VERIFY_TTL_HOURS = 24;
export const INVITE_TTL_HOURS = 72;
export const PASSWORD_RESET_TTL_MIN = 30;

/** FR-AUTH-010 동일 IP 시간당 사업자 가입 신청 상한 */
export const BUSINESS_SIGNUP_PER_IP_PER_HOUR = 3;
/** 미검증 사업자 신청 자동 삭제 기준 */
export const UNVERIFIED_BUSINESS_TTL_DAYS = 7;

/** 로그인 실패 백오프: 15분 창 안에서 5회부터 1s → 2s → … → 32s */
export const LOGIN_FAIL_WINDOW_MIN = 15;
export const LOGIN_FAIL_FREE_ATTEMPTS = 5;
export const LOGIN_FAIL_MAX_DELAY_SEC = 32;

export const COOKIE_SESSION = "majubom.session"; // Auth.js 세션 JWT (액세스 스냅샷)
export const COOKIE_REFRESH = "majubom.refresh"; // 서버 저장 리프레시 토큰 원문 (sid.secret)

/** 로그인이 필요한 경로 접두 (프록시가 리다이렉트). API 는 401 로 답한다 */
export const PROTECTED_PAGE_PREFIXES = ["/console", "/admin", "/me"];
export const PROTECTED_API_PREFIXES = ["/api/console", "/api/admin", "/api/me"];
/** 매 요청 상태 재확인 대상 (콘솔·관리자) */
export const CONSOLE_PREFIXES = ["/console", "/api/console"];
export const ADMIN_PREFIXES = ["/admin", "/api/admin"];
