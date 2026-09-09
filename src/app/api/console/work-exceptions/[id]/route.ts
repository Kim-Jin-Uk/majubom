import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { deleteException } from "@/features/schedule/work-exceptions";
import { uuidParam } from "@/lib/api";

/** DELETE /api/console/work-exceptions/:id — OWNER 전부, MANAGER 는 본인의 차단(BLOCK) 또는 대기·반려 신청(취소) */
export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  await deleteException(v.membership.businessId, uuidParam((await ctx.params).id), { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId });
  return NextResponse.json({ ok: true });
});
