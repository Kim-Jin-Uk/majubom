import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { listSessions, revokeAllSessions } from "@/features/auth/session-store";

/**
 * GET /api/me/sessions — 활성 세션(기기) 목록 (FR-AUTH-030 기기 관리 · FR-NOTI-030 "설치된 기기" 화면에 통합 예정)
 * DELETE /api/me/sessions — 현재 기기를 제외한 전부 폐기
 */
export const GET = handle(async () => {
  const v = await requireUser();
  return NextResponse.json({ sessions: await listSessions(v.uid, v.sid ?? undefined) });
});

export const DELETE = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const revoked = await revokeAllSessions(v.uid, v.sid ?? undefined);
  return NextResponse.json({ ok: true, revoked });
});
