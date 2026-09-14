import { afterEach, describe, expect, it, vi } from "vitest";
import { skipTotp } from "./dev-flags";

/**
 * ADMIN 2단계 인증을 끄는 스위치. **프로덕션에서 열리면 운영자 계정이 비밀번호 하나로 열린다** —
 * 그래서 값이 아니라 환경으로 먼저 막는다. 이 파일은 그 잠금이 살아 있는지만 본다.
 */
afterEach(() => vi.unstubAllEnvs());

describe("skipTotp", () => {
  it("프로덕션에서는 어떤 값을 넣어도 꺼진다", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const v of ["true", "TRUE", "1", "yes"]) {
      vi.stubEnv("AUTH_DEV_SKIP_TOTP", v);
      expect(skipTotp(), v).toBe(false);
    }
  });

  it("로컬·테스트에서 정확히 \"true\" 일 때만 켜진다", () => {
    for (const nodeEnv of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("AUTH_DEV_SKIP_TOTP", "true");
      expect(skipTotp(), nodeEnv).toBe(true);
      // 느슨하게 받으면 "false" 아닌 값이 전부 켜짐이 된다 — 오타 하나가 2단계를 끄면 안 된다
      for (const v of ["1", "yes", "false", ""]) {
        vi.stubEnv("AUTH_DEV_SKIP_TOTP", v);
        expect(skipTotp(), `${nodeEnv}/${v}`).toBe(false);
      }
    }
  });

  it("값이 없으면 꺼져 있다 — 기본이 안전한 쪽이다", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_DEV_SKIP_TOTP", "");
    expect(skipTotp()).toBe(false);
  });
});

describe("env 스키마", () => {
  it("production 에서 켜면 부팅을 막는다", async () => {
    const { serverEnvSchema } = await import("@/lib/env");
    const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x/y", AUTH_SECRET: "x".repeat(32), AUTH_URL: "https://majubom.kr", RESEND_API_KEY: "re_x" };
    expect(serverEnvSchema.safeParse(base).success).toBe(true);
    const bad = serverEnvSchema.safeParse({ ...base, AUTH_DEV_SKIP_TOTP: "true" });
    expect(bad.success).toBe(false);
    expect(bad.success === false && bad.error.issues.some((i) => i.path[0] === "AUTH_DEV_SKIP_TOTP")).toBe(true);
  });
});
