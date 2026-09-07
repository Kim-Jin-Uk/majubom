import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * 이미지: 1기에는 next/image 옵티마이저가 R2 공개 URL 을 리사이즈한다.
 * 커스텀 도메인(media.majubom.kr)이 붙으면 Cloudflare Image Transformations 로 교체 (#9).
 * R2_PUBLIC_BASE_URL 이 없으면(빌드 시점) 패턴을 비워 둔다 — 로컬 개발은 /public 만 쓴다.
 */
const r2Public = process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL) : null;

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
