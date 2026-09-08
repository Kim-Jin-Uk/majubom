import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * 헬스체크. proxy.ts 의 Basic Auth 예외 경로 — App Hosting/모니터가 인증 없이 친다.
 * DB 를 건드리지 않는다: 이 엔드포인트는 "프로세스가 살아 있는가" 만 답한다.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, version: pkg.version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
