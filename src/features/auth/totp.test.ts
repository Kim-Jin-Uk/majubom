import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

/** otpauth 라이브러리 계약 확인 — 우리 설정(SHA1 · 6자리 · 30초 · window 1)이 표준 인증 앱과 맞물리는지 */
describe("TOTP 파라미터", () => {
  it("같은 시크릿·시각이면 같은 코드, window 1 은 ±30초를 받아준다", () => {
    const secret = OTPAuth.Secret.fromBase32("JBSWY3DPEHPK3PXP");
    const a = new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" });
    const now = Date.now();
    const code = a.generate({ timestamp: now });
    expect(code).toMatch(/^\d{6}$/);
    expect(a.validate({ token: code, timestamp: now, window: 1 })).toBe(0);
    expect(a.validate({ token: code, timestamp: now + 30_000, window: 1 })).toBe(-1);
    expect(a.validate({ token: code, timestamp: now + 90_000, window: 1 })).toBeNull();
  });
});
