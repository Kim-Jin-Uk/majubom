import type { Principal } from "./principal";

/** 소셜 로그인이 이메일을 주지 않아 가입을 끝내지 못한 상태 (FR-AUTH-030 이메일 필수) */
export type PendingProfile = {
  provider: "KAKAO" | "GOOGLE";
  providerAccountId: string;
  name: string | null;
};

export type MfaState = "ok" | "pending";

/**
 * JWT(액세스 스냅샷) 페이로드. Auth.js 기본 필드(name/email/picture/sub/iat/exp/jti)에 더해 아래를 싣는다.
 * 쿠키는 암호화(JWE)되지만 클라이언트가 들고 다니므로 연락처·이메일은 넣지 않는다.
 */
export type AppTokenFields = {
  uid?: string;
  /** sessions.id — 리프레시 토큰 행 */
  sid?: string;
  /** unix seconds. 지나면 프록시가 리프레시 토큰으로 갱신 (15분) */
  accessExp?: number;
  p?: Principal;
  mfa?: MfaState;
  pending?: PendingProfile;
};

declare module "next-auth" {
  interface Session {
    /** id 는 uid. pending(가입 미완) 이면 빈 문자열 */
    user: { id: string; name: string } & Record<string, unknown>;
    principal: Principal | null;
    mfa: MfaState;
    /** 소셜 이메일 미제공 — /signup/complete 로 보낸다 */
    pending: PendingProfile | null;
    accessExp: number | null;
    /** 현재 리프레시 세션 id (기기 목록에서 "이 기기" 표시) */
    sid: string | null;
  }
}

declare module "@auth/core/jwt" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 모듈 확장(merge) 선언
  interface JWT extends AppTokenFields {}
}
