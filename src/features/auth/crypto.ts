import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

/**
 * 비밀번호 해시 — Node 내장 scrypt. 네이티브 의존성이 없어 CI·App Hosting 빌드팩에서 깨질 여지가 없다.
 * 파라미터는 OWASP 권고(N=2^17, r=8, p=1, 64B). 포맷 `scrypt$N$r$p$salt_b64$hash_b64` — 나중에 파라미터를 올려도
 * 기존 해시는 그대로 검증되고, 로그인 성공 시 재해시하면 된다.
 */
const SCRYPT = { N: 1 << 17, r: 8, p: 1, keylen: 64, maxmem: 256 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // 소셜 전용 계정 — 응답 시간을 맞추기 위해 한 번은 계산한다
    await scryptAsync("x", Buffer.alloc(16), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
    return false;
  }
  const [alg, N, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 해시 파라미터가 현재 기준보다 낮으면 true — 로그인 성공 시 재해시 대상 */
export function passwordNeedsRehash(stored: string): boolean {
  const [, N] = stored.split("$");
  return Number(N) < SCRYPT.N;
}

/** URL-safe 랜덤 토큰. 32B → 43자 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 6자리 숫자 OTP (crypto.randomInt — Math.random 금지) */
export function randomOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * 작은 시크릿(TOTP 시드 등)의 대칭 암호화 — AES-256-GCM, 키는 AUTH_SECRET 에서 HKDF 로 용도별 파생.
 * 포맷 `v1.<iv_b64url>.<tag_b64url>.<ct_b64url>`. AUTH_SECRET 회전 시 복호화가 불가해지므로 회전 절차(08 §8)에 넣는다.
 */
function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "majubom", purpose, 32));
}

export function encryptSecret(plain: string, secret: string, purpose = "totp"): string {
  const key = deriveKey(secret, purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptSecret(enc: string, secret: string, purpose = "totp"): string {
  const [v, ivB, tagB, ctB] = enc.split(".");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("암호문 포맷 오류");
  const key = deriveKey(secret, purpose);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * 서버 내부 증명 토큰 — `unstable_update()` 로 JWT 를 바꿀 때 "이 변경은 서버 라우트가 검증한 것" 을 jwt 콜백에 증명한다.
 * Auth.js 의 세션 update 엔드포인트는 클라이언트도 (CSRF 토큰과 함께) 호출할 수 있어, 본문의 값을 그대로 믿으면
 * TOTP 를 건너뛸 수 있다. 시크릿을 모르면 만들 수 없는 HMAC 으로 막는다.
 */
export function serverProof(purpose: string, subject: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret, "proof")).update(`${purpose}:${subject}`).digest("base64url");
}

export function verifyServerProof(proof: unknown, purpose: string, subject: string, secret: string): boolean {
  return typeof proof === "string" && safeEqualString(proof, serverProof(purpose, subject, secret));
}
