import { NextResponse } from "next/server";

/** 라우트가 던지는 HTTP 오류. guards.handle() 이 JSON 으로 바꾼다 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
  toResponse(): NextResponse {
    return NextResponse.json({ error: this.code, ...this.extra }, { status: this.status, headers: { "Cache-Control": "no-store" } });
  }
}
