import { NextResponse } from "next/server";
import { handle, HttpError } from "@/features/auth/guards";
import { previewInvite } from "@/features/auth/members";

/** GET /api/auth/invitations/:token — 초대 미리보기 (FR-AUTH-020). 수락은 POST …/accept */
export const GET = handle(async (_req, ctx) => {
  const { token } = await ctx.params;
  const r = await previewInvite(token);
  if (!r.ok) throw new HttpError(400, `INVITE_${r.reason}`);
  return NextResponse.json(r);
});
