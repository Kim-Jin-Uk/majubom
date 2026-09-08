import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { COOKIE_REFRESH, REFRESH_TTL_SEC } from "./constants";
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

export function clearedRefreshCookie(): { name: string; value: string; options: Partial<ResponseCookie> } {
  return { name: COOKIE_REFRESH, value: "", options: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 } };
}
