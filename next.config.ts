import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * 이미지 리사이즈는 **업로드 시점에 끝난다** (#9 · L-40). sharp 가 만든 여러 폭을 R2 에 같이 올리고,
 * 화면은 `components/Img` 가 `srcSet` 으로 고른다. 그래서 `next/image` 옵티마이저 설정이 없다 —
 * 옵티마이저는 요청마다 우리 Cloud Run CPU 를 태우는데, R2 는 정적 파일을 이그레스 무료로 뱉는다.
 */

/**
 * 보안 헤더 (08 §2 보안). CSP 는 프레임 삽입만 막는 최소형 — 스크립트 CSP 는 Next 인라인 스크립트(테마 초기화)와 nonce 배선이
 * 필요해 콘솔 화면이 붙는 시점에 함께 넣는다. HSTS 는 App Hosting 이 항상 HTTPS 이므로 안전하다.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

/**
 * Sentry 빌드 플러그인. SENTRY_AUTH_TOKEN 이 있을 때만 소스맵을 업로드하고,
 * 없으면(로컬·PR CI) 조용히 건너뛴다 — 런타임 SDK 동작에는 영향 없다.
 * 트리셰이킹 옵션은 Turbopack 에서는 무시되지만 webpack 폴백 빌드를 위해 남긴다.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !hasSentryAuthToken,
  telemetry: false,
  sourcemaps: {
    disable: !hasSentryAuthToken,
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
