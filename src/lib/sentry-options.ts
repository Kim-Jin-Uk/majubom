import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";

/**
 * 서버·엣지·클라이언트 세 곳의 Sentry.init 이 공유하는 옵션.
 * `@sentry/nextjs` 타입을 import 하지 않는다 — 클라이언트 번들에 서버 타입을 끌어오지 않기 위해
 * 구조적 타이핑으로 맞춘다 (init 의 파라미터 타입에 그대로 대입 가능).
 */
export function baseSentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,

    // FR-PRIV-010: IP · 쿠키 · 사용자 기본 정보를 자동으로 붙이지 않는다
    sendDefaultPii: false,

    // 1기에는 트레이스를 최소로. 에러만 본다
    tracesSampleRate: 0,

    beforeSend<E extends object>(event: E): E {
      return scrubEvent(event);
    },
    beforeSendTransaction<E extends object>(event: E): E {
      return scrubEvent(event);
    },
    beforeBreadcrumb<B extends object>(breadcrumb: B): B {
      return scrubBreadcrumb(breadcrumb);
    },
  };
}
