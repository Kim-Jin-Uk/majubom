import { serverEnv } from "@/lib/env";

/**
 * 기능 플래그 (08 §2.3).
 *
 * - 서버 전용 환경변수(FEATURE_*)만 읽는다. `NEXT_PUBLIC_` 금지 — 스테이징/프로덕션 번들이
 *   같은 바이너리여야 하고, 미공개 기능의 존재가 브라우저에 새면 안 된다.
 * - 플래그가 꺼져 있으면 해당 라우트는 404 로 응답한다 (`notFound()`).
 * - 하드캡 2개. 마일스톤이 끝나면 플래그를 지운다.
 * - getter 라서 import 시점에 env 를 파싱하지 않는다 (빌드 타임 안전).
 */
export const flags = {
  /** M6 빌더 (W17–21) */
  get builder(): boolean {
    return serverEnv().FEATURE_BUILDER;
  },
  /** M8 채팅 (W23–25) */
  get chat(): boolean {
    return serverEnv().FEATURE_CHAT;
  },
} as const;

export type FlagName = keyof typeof flags;
