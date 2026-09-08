import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { resendInvite } from "@/features/auth/members";
import { requestMeta } from "@/lib/request-meta";

/** POST /api/console/members/:id/resend-invite — 초대 링크 재발송 (OWNER). 이전 링크는 무효화 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { id } = await ctx.params;
  await resendInvite(v.membership.businessId, id, { uid: v.uid, name: v.principal.name }, requestMeta(req.headers));
  return NextResponse.json({ ok: true });
});
