import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, passwordNeedsRehash, randomOtp, safeEqualString, serverProof, verifyPassword, verifyServerProof } from "./crypto";

describe("password (scrypt)", () => {
  it("해시 후 검증 · 다른 비밀번호 거부 · NFKC 정규화", async () => {
    const h = await hashPassword("Passw0rd!");
    expect(h.startsWith("scrypt$16384$8$5$")).toBe(true);
    expect(await verifyPassword("Passw0rd!", h)).toBe(true);
    expect(await verifyPassword("passw0rd!", h)).toBe(false);
    // 전각 '１' 과 반각 '1' 은 NFKC 로 같아진다
    const h2 = await hashPassword("abc１２３４５");
    expect(await verifyPassword("abc12345", h2)).toBe(true);
  }, 20_000);

  it("소셜 전용(null) · 깨진 포맷은 false (예외 없음)", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "bcrypt$nope")).toBe(false);
  }, 20_000);

  it("파라미터가 현재 기준과 다르면 재해시 대상 · 비정상 파라미터는 검증 거부", async () => {
    expect(passwordNeedsRehash("scrypt$131072$8$1$a$b")).toBe(true);
    expect(passwordNeedsRehash("scrypt$16384$8$5$a$b")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1048576$8$1$AAAA$AAAA")).toBe(false);
  });
});

describe("secret encryption (AES-256-GCM)", () => {
  it("라운드트립 · 키가 다르면 실패 · 변조 감지", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP", "s".repeat(40));
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, "s".repeat(40))).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(enc, "t".repeat(40))).toThrow();
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
    expect(() => decryptSecret(tampered, "s".repeat(40))).toThrow();
  });
});

describe("server proof", () => {
  it("같은 (purpose, subject, secret) 만 통과 · 2분 지나면 만료", () => {
    const now = 1_800_000_000_000;
    const p = serverProof("mfa", "sid-1", "secret".repeat(6), now);
    expect(verifyServerProof(p, "mfa", "sid-1", "secret".repeat(6), now)).toBe(true);
    expect(verifyServerProof(p, "mfa", "sid-1", "secret".repeat(6), now + 59_000)).toBe(true);
    expect(verifyServerProof(p, "mfa", "sid-1", "secret".repeat(6), now + 121_000)).toBe(false);
    expect(verifyServerProof(p, "mfa", "sid-2", "secret".repeat(6), now)).toBe(false);
    expect(verifyServerProof(p, "bind", "sid-1", "secret".repeat(6), now)).toBe(false);
    expect(verifyServerProof(undefined, "mfa", "sid-1", "secret".repeat(6), now)).toBe(false);
  });
});

describe("misc", () => {
  it("OTP 는 6자리 숫자", () => {
    for (let i = 0; i < 50; i++) expect(randomOtp()).toMatch(/^\d{6}$/);
  });
  it("safeEqualString", () => {
    expect(safeEqualString("a", "a")).toBe(true);
    expect(safeEqualString("a", "ab")).toBe(false);
  });
});
