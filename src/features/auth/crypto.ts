import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

/**
 * 비밀번호 해시 — Node 내장 scrypt. 네이티브 의존성이 없어 CI·App Hosting 빌드팩에서 깨질 여지가 없다.
 *
 * 파라미터는 OWASP 권고 조합 중 **메모리가 작은 쪽**(N=2^14, r=8, p=5 → 16 MiB, 비용은 N=2^17·p=1 과 동급).
 * App Hosting 인스턴스가 512 MiB 라 128 MiB 짜리 해시를 동시에 몇 개만 돌려도 OOM 이 난다(리뷰 지적).
 * 여기에 프로세스 전역 세마포어(MAX_CONCURRENT)로 동시 계산 수를 묶는다 — 미인증 요청이 메모리를 폭주시키지 못하게.
 * 포맷 `scrypt$N$r$p$salt_b64$hash_b64` — 파라미터를 바꿔도 기존 해시는 검증되고, 로그인 성공 시 재해시된다.
 */
const SCRYPT = { N: 1 << 14, r: 8, p: 5, keylen: 64, maxmem: 64 * 1024 * 1024 };
const MAX_CONCURRENT = 4;
let running = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiters.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

function derive(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return withSlot(() => scryptAsync(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.keylen, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** 존재하지 않는 계정·소셜 전용 계정에도 같은 비용을 치르게 하는 더미 (응답 시간 맞추기) */
const DUMMY_SALT = Buffer.alloc(16, 7);

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    await derive("x", DUMMY_SALT, SCRYPT.keylen, SCRYPT.N, SCRYPT.r, SCRYPT.p);
    return false;
  }
  const [alg, N, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const n = Number(N);
  // 저장된 파라미터가 비정상적으로 크면(조작된 행) 계산을 거부한다 — 메모리 폭주 방지
  if (!Number.isInteger(n) || n > 1 << 17 || Number(r) > 16 || Number(p) > 16) return false;
  const key = await derive(password, Buffer.from(saltB64, "base64"), expected.length, n, Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 해시 파라미터가 현재 기준보다 낮으면 true — 로그인 성공 시 재해시 대상 */
export function passwordNeedsRehash(stored: string): boolean {
  const [, N, r, p] = stored.split("$");
  return Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p;
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
 * TOTP 를 건너뛸 수 있다. 시크릿을 모르면 만들 수 없는 HMAC 으로 막고, **발급 시각(분 단위)** 을 넣어 유효창을 짧게 둔다 —
 * 한 번 통과한 증명을 붙잡아 두고 나중에 다시 쓰는 것을 막는다 (현재 분과 직전 분만 통과).
 */
const PROOF_WINDOW_SEC = 60;

export function serverProof(purpose: string, subject: string, secret: string, nowMs = Date.now()): string {
  const slot = Math.floor(nowMs / 1000 / PROOF_WINDOW_SEC);
  return createHmac("sha256", deriveKey(secret, "proof")).update(`${purpose}:${subject}:${slot}`).digest("base64url");
}

export function verifyServerProof(proof: unknown, purpose: string, subject: string, secret: string, nowMs = Date.now()): boolean {
  if (typeof proof !== "string") return false;
  return safeEqualString(proof, serverProof(purpose, subject, secret, nowMs)) || safeEqualString(proof, serverProof(purpose, subject, secret, nowMs - PROOF_WINDOW_SEC * 1000));
}
