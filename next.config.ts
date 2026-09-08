import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * 이미지: 1기에는 next/image 옵티마이저가 R2 공개 URL 을 리사이즈한다.
 * 커스텀 도메인(media.majubom.kr)이 붙으면 Cloudflare Image Transformations 로 교체 (#9).
 * R2_PUBLIC_BASE_URL 이 없으면(빌드 시점) 패턴을 비워 둔다 — 로컬 개발은 /public 만 쓴다.
 */
const r2Public = process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL) : null;

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
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: r2Public
      ? [{ protocol: r2Public.protocol.replace(":", "") as "https" | "http", hostname: r2Public.hostname, pathname: "/**" }]
      : [],
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
