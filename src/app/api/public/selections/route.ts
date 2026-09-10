import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle } from "@/features/auth/guards";
import { createSelection, selectionSchema } from "@/features/booking/widget/selection";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/public/selections — 로그인 직전의 선택을 서버에 맡긴다 (FR-AUTH-030, #83).
 *
 * **로그인 없이 부른다** — 이 토큰의 존재 이유가 "아직 로그인하지 않았다" 이기 때문이다.
 * 자리를 잡아 두지 않으므로 예약과는 무관하고, 남용은 IP 시간당 상한으로 막는다.
 * `assertWritable` 은 걸지 않는다 — 사업장 읽기 전용(SUSPENDED)은 애초에 홈이 404 라 여기까지 오지 못한다.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req, selectionSchema);
  const { id } = await createSelection(body, requestMeta(req.headers));
  return NextResponse.json({ ok: true, selectionId: id }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
