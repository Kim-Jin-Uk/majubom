import * as Sentry from "@sentry/nextjs";

/**
 * Next 서버 계측 훅. 런타임별 Sentry 설정 파일을 등록한다.
 * DSN 이 없으면 각 설정 파일이 init 을 건너뛰므로 로컬·CI 에서는 아무 일도 하지 않는다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** 서버 컴포넌트 · 라우트 핸들러 · 서버 액션의 미처리 에러를 Sentry 로 */
export const onRequestError = Sentry.captureRequestError;
