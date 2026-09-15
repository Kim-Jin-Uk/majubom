import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { profileInputSchema, updateProfile } from "@/features/me/profile";
import { readJson } from "@/lib/api";

/**
 * PUT /api/me/profile — 이름·연락처 수정 (FR-NOTI-030 마이페이지, #90).
 * 이메일은 받지 않는다 — 로그인 아이디라 바꾸려면 새 주소 검증이 먼저다.
 */
export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  await updateProfile(v.uid, await readJson(req, profileInputSchema));
  return NextResponse.json({ ok: true });
});
