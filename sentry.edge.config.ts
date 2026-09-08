// Edge 런타임 Sentry 초기화. src/instrumentation.ts 의 register() 에서 로드된다.
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/sentry-options";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init(baseSentryOptions(dsn));
}
