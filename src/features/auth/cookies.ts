import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { COOKIE_REFRESH, COOKIE_SESSION, REFRESH_TTL_SEC } from "./constants";
import { serializeRefresh, type RefreshToken } from "./session-store";

/**
 * 리프레시 쿠키 옵션. Path 를 `/` 로 두는 이유: 갱신은 프록시가 어느 경로에서든 수행한다 (전용 엔드포인트가 없다).
 * SameSite=Lax — 쿠키 인증 CSRF 방어의 1차 (2차는 상태 변경 API 의 Origin 검사, csrf.ts).
 */
export function refreshCookie(token: RefreshToken): { name: string; value: string; options: Partial<ResponseCookie> } {
  return {
    name: COOKIE_REFRESH,
    value: serializeRefresh(token),
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFRESH_TTL_SEC,
    },
  };
}

/**
 * 삭제용 쿠키 옵션. `maxAge: 0` 만 쓰면 Next 가 Set-Cookie 를 다시 직렬화할 때(미들웨어·cookies() 병합) falsy 값을
 * 떨어뜨려 "삭제" 가 "세션 쿠키" 로 둔갑한다 — `expires: epoch` 를 함께 준다 (Date 객체는 살아남는다).
 */
export function deletionOptions(): Partial<ResponseCookie> {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0, expires: new Date(0) };
}

export function clearedRefreshCookie(): { name: string; value: string; options: Partial<ResponseCookie> } {
  return { name: COOKIE_REFRESH, value: "", options: deletionOptions() };
}

export function clearedSessionCookie(): { name: string; value: string; options: Partial<ResponseCookie> } {
  return { name: COOKIE_SESSION, value: "", options: deletionOptions() };
}
