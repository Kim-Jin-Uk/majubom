import * as Sentry from "@sentry/nextjs";

/**
 * Next 서버 계측 훅. 런타임별 Sentry 설정 파일을 등록한다.
 * DSN 이 없으면 각 설정 파일이 init 을 건너뛰므로 로컬·CI 에서는 아무 일도 하지 않는다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    // 환경변수는 지연 검증(serverEnv)이라 빌드는 통과하지만, 프로덕션 부팅 시점에 한 번 돌려 배포 직후 바로 실패하게 한다 —
    // AUTH_URL 누락·짝이 안 맞는 소셜 키 같은 설정 오류가 첫 사용자의 500 으로 드러나지 않게 (리뷰 지적)
    if (process.env.NODE_ENV === "production") {
      const { serverEnv } = await import("./lib/env");
      serverEnv();
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** 서버 컴포넌트 · 라우트 핸들러 · 서버 액션의 미처리 에러를 Sentry 로 */
export const onRequestError = Sentry.captureRequestError;
