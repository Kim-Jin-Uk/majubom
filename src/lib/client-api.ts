"use client";

/**
 * 클라이언트 → 우리 API 호출 헬퍼. 상태 변경은 같은 출처에서만 오므로 브라우저가 Sec-Fetch-Site: same-origin 을 붙인다
 * (features/auth/csrf.ts 가 검사). 응답 형식은 라우트 공통 `{ error, issues?, ... }`.
 */
export type ApiIssue = { path: (string | number)[]; message: string };
export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; error: string; message?: string; issues?: ApiIssue[]; retryAfterSec?: number; data?: Record<string, unknown> };

export async function apiPost<T = Record<string, unknown>>(url: string, body: unknown): Promise<ApiResult<T>> {
  return apiCall<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export async function apiDelete<T = Record<string, unknown>>(url: string): Promise<ApiResult<T>> {
  return apiCall<T>(url, { method: "DELETE" });
}

async function apiCall<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: "NETWORK", message: "네트워크 연결을 확인해 주세요" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, data: data as T, status: res.status };
  const retry = res.headers.get("retry-after");
  return {
    ok: false,
    status: res.status,
    error: typeof data.error === "string" ? data.error : `HTTP_${res.status}`,
    message: typeof data.message === "string" ? data.message : undefined,
    issues: Array.isArray(data.issues) ? (data.issues as ApiIssue[]) : undefined,
    retryAfterSec: retry ? Number(retry) : undefined,
    data,
  };
}

/** zod issues → { 필드명: 첫 메시지 } */
export function fieldErrors(issues?: ApiIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues ?? []) {
    const k = String(i.path[0] ?? "_");
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

/** 서버 오류 코드 → 사용자 문구. 모르는 코드는 일반 문구 */
export function describeError(r: { error: string; message?: string; retryAfterSec?: number }): string {
  if (r.message) return r.message;
  switch (r.error) {
    case "INVALID_BODY":
      return "입력 내용을 확인해 주세요";
    case "EMAIL_TAKEN":
      return "이미 사용 중인 이메일입니다";
    case "BIZ_REG_NO_TAKEN":
      return "이미 등록된 사업자번호입니다";
    case "RATE_LIMITED":
      return `요청이 너무 많습니다. ${r.retryAfterSec ? `${r.retryAfterSec}초 후` : "잠시 후"} 다시 시도해 주세요`;
    case "UNAUTHENTICATED":
      return "로그인이 필요합니다";
    case "CSRF":
      return "요청 출처를 확인할 수 없습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요";
    case "NETWORK":
      return "네트워크 연결을 확인해 주세요";
    default:
      return "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요";
  }
}
