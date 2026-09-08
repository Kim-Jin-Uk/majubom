import { handlers } from "@/features/auth/auth";

/**
 * Auth.js 엔드포인트 — /api/auth/{signin,callback,session,csrf,signout,providers}/…
 * 우리 라우트(/api/auth/signup 등)는 형제 디렉터리에 두고, catch-all 은 Auth.js 만 받는다.
 * 프록시의 Basic Auth 예외 경로(/api/auth/*)라 카카오·구글 콜백이 게이트를 통과한다.
 */
export const { GET, POST } = handlers;
