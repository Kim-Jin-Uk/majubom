import { z } from "zod";

// `server-only` 패키지는 의존성에 없으므로 런타임 가드로 대신한다.
if (typeof window !== "undefined") {
  throw new Error("src/lib/env.ts is server-only and must not be imported from client code");
}

/**
 * 서버 전용 환경변수 스키마.
 *
 * - 빌드 타임에는 env 가 없을 수 있으므로 모듈 import 만으로는 파싱하지 않는다.
 *   `serverEnv()` 를 처음 호출하는 순간 검증하고, 실패하면 어떤 키가 왜 틀렸는지 던진다.
 * - `NEXT_PUBLIC_` 접두 변수는 여기 두지 않는다 (08 §2.3). 클라이언트에 노출할 값은 없다.
 * - boolean 은 "true" | "false" | "1" | "0" | "yes" | "no" 등 문자열을 받는다 (zod stringbool).
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // DB (Neon). UNPOOLED 는 마이그레이션 전용 직결 (08 §5.5)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  // 1기 게이트 (08 §3.1). 기본 켜짐 — 끄려면 명시적으로 GATE_ENABLED=false
  GATE_ENABLED: z.stringbool().default(true),
  /** "user:pass" 형식. 비어 있으면 Basic Auth 를 걸지 않는다 */
  GATE_BASIC_AUTH: z
    .string()
    .regex(/^[^:]+:.+$/, 'GATE_BASIC_AUTH must be "user:pass"')
    .optional(),

  // 관측
  SENTRY_DSN: z.url().optional(),

  // 스토리지 (Cloudflare R2, S3 호환). 넷이 세트 — 하나만 있으면 설정 오류로 본다
  /** 32자 hex. S3 엔드포인트 https://<ACCOUNT_ID>.r2.cloudflarestorage.com 의 앞부분. cfat_… 토큰 값이 아니다 */
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, "R2_ACCOUNT_ID 는 32자 hex 다 — cfat_ 로 시작하는 토큰 값을 넣었다면 자리가 틀렸다").optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /** 공개 URL 베이스. 1기: https://pub-xxxx.r2.dev / 2기: https://media.majubom.kr — S3 엔드포인트(r2.cloudflarestorage.com)가 아니다 */
  R2_PUBLIC_BASE_URL: z.url().refine((u) => !/r2\.cloudflarestorage\.com/.test(u), "R2_PUBLIC_BASE_URL 에 S3 엔드포인트를 넣었다 — 버킷 Settings 의 Public Development URL(pub-….r2.dev) 이어야 한다").optional(),

  // 기능 플래그 (08 §2.3) — 하드캡 2개
  FEATURE_BUILDER: z.stringbool().default(false),
  FEATURE_CHAT: z.stringbool().default(false),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** R2 넷 중 일부만 설정된 상태를 잡는다 */
export function r2Configured(env: Pick<ServerEnv, "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET" | "R2_PUBLIC_BASE_URL">): boolean {
  const vals = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET, env.R2_PUBLIC_BASE_URL];
  const set = vals.filter(Boolean).length;
  if (set !== 0 && set !== vals.length) throw new Error("R2_* 환경변수는 5개가 세트다 — 일부만 설정돼 있다");
  return set === vals.length;
}

let cached: ServerEnv | undefined;

/** 빈 문자열은 "미설정" 으로 취급한다 (App Hosting 에서 빈 값이 내려올 수 있다) */
function stripEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * 검증된 서버 환경변수. 첫 호출에서 파싱 후 캐시한다.
 * 실패 시 Error 를 던지며 메시지에 문제 키 목록이 들어간다.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(stripEmpty(process.env));
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/**
 * 1기 게이트 on/off 만 따로 읽는다. robots.ts 처럼 DB 설정과 무관한 곳에서
 * DATABASE_URL 누락 때문에 함께 죽지 않도록 전체 스키마를 거치지 않는다.
 * 파싱 불가한 값("maybe" 등)은 안전한 쪽(켜짐)으로 본다.
 */
export function gateEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  const raw = source.GATE_ENABLED;
  if (raw === undefined || raw === "") return true;
  const parsed = serverEnvSchema.shape.GATE_ENABLED.safeParse(raw);
  return parsed.success ? parsed.data : true;
}

/** 테스트용: 캐시를 비운다 */
export function resetServerEnvCache(): void {
  cached = undefined;
}
