import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { decideException, decisionInputSchema } from "@/features/schedule/work-exceptions";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/console/work-exceptions/:id/decide — 매니저 휴가 신청 승인·반려 (OWNER).
 * 승인은 등록과 같은 충돌 검사: 사라지는 근무 구간에 예약이 있으면 409 EXCEPTION_CONFLICT, confirmConflicts 로 강행. 이미 처리된 신청은 409 NOT_PENDING
 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, decisionInputSchema);
  const r = await decideException(v.membership.businessId, uuidParam((await ctx.params).id), body, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId }, requestMeta(req.headers));
  return NextResponse.json({ ok: true, ...r });
});
