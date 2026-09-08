// 브라우저 Sentry 초기화. 앱이 인터랙티브해지기 전에 실행된다.
// 클라이언트 번들에 인라인되므로 DSN 은 NEXT_PUBLIC_SENTRY_DSN 으로 받는다 (DSN 은 공개 값이다).
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/sentry-options";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...baseSentryOptions(dsn),
    // 세션 리플레이는 화면에 PII 가 그대로 찍히므로 1기에는 켜지 않는다
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

/** App Router 네비게이션을 Sentry 트랜잭션으로 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
