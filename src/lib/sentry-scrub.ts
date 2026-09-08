/**
 * Sentry PII 스크러빙 (02 FR-PRIV-010 "Sentry 브레드크럼 | PII 스크러빙 필터 적용").
 *
 * 이벤트·브레드크럼 전체를 깊이 우선으로 훑어
 *   - 키 이름이 PII 성 (phone, email, fcmToken, authorization, cookie …) 이면 값을 통째로 [redacted]
 *   - 문자열 값 안의 이메일 · 한국 휴대폰 번호 패턴을 [redacted] 로 치환
 * 한다. Sentry 타입에 의존하지 않는 순수 함수라 vitest 에서 그대로 검증한다.
 */

export const REDACTED = "[redacted]";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** 010-1234-5678, 01012345678, 011-123-4567, 010 1234 5678 … (하이픈·공백 선택) */
const KR_MOBILE_RE = /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g;

/** 값 전체를 지우는 키 (대소문자 무시, `-`/`_` 무시) */
const SENSITIVE_KEYS = new Set([
  "phone",
  "phonenumber",
  "mobile",
  "email",
  "fcmtoken",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "accesstoken",
  "refreshtoken",
  "idtoken",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

export function scrubString(input: string): string {
  return input.replace(EMAIL_RE, REDACTED).replace(KR_MOBILE_RE, REDACTED);
}

const MAX_DEPTH = 12;

/**
 * 임의의 값을 스크러빙한 새 값으로 돌려준다. 원본은 바꾸지 않는다.
 * 순환 참조는 한 번만 방문하고, 깊이 한도를 넘는 가지는 잘라낸다.
 */
export function scrubValue<T>(value: T, seen: WeakSet<object> = new WeakSet(), depth = 0): T {
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return "[truncated]" as unknown as T;

  const obj = value as unknown as object;
  if (seen.has(obj)) return "[circular]" as unknown as T;
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((v) => scrubValue(v, seen, depth + 1)) as unknown as T;
  }

  // Error 등 특수 객체: message/stack 만 문자열로 정리
  if (obj instanceof Error) {
    const e = new Error(scrubString(obj.message));
    e.name = obj.name;
    if (obj.stack) e.stack = scrubString(obj.stack);
    return e as unknown as T;
  }

  if (obj instanceof Date || obj instanceof RegExp) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isSensitiveKey(k) && v !== undefined && v !== null ? REDACTED : scrubValue(v, seen, depth + 1);
  }
  return out as T;
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction` 용.
 * 제네릭이라 ErrorEvent · TransactionEvent 어느 쪽에도 그대로 쓴다.
 */
export function scrubEvent<E extends object>(event: E): E {
  return scrubValue(event);
}

/** Sentry `beforeBreadcrumb` 용 */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B {
  return scrubValue(breadcrumb);
}
