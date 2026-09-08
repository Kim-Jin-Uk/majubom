import { NextResponse } from "next/server";

/** 라우트가 던지는 HTTP 오류. guards.handle() 이 JSON 으로 바꾼다 */
/**
 * pg 오류 코드. drizzle 0.45 는 드라이버 오류를 DrizzleQueryError 로 감싸고 원인을 `cause` 에 둔다 — `e.code` 만 보면 영원히 못 잡는다.
 */
export function pgCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const direct = (e as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && typeof (cause as { code?: unknown }).code === "string") return (cause as { code: string }).code;
  return undefined;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
  toResponse(): NextResponse {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    const retry = this.extra.retryAfterSec;
    if (typeof retry === "number" && retry > 0) headers["Retry-After"] = String(Math.ceil(retry));
    return NextResponse.json({ error: this.code, ...this.extra }, { status: this.status, headers });
  }
}
