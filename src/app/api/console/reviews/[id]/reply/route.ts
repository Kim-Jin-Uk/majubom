import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { deleteReply, upsertReply } from "@/features/review/reviews";
import { replyInputSchema } from "@/features/review/rules";
import { readJson, uuidParam } from "@/lib/api";

/**
 * PUT/DELETE /api/console/reviews/:id/reply — 사업자 답글 (FR-REV-020, #93).
 *
 * **리뷰 자체를 지우거나 숨기는 경로는 만들지 않는다.** 사업자가 임의로 지울 수 있으면 리뷰 신뢰도가 0 이 된다 —
 * 부적절한 리뷰는 신고로 간다(FR-ADM-060). 거둘 수 있는 것은 자기 답글뿐이다.
 */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  await upsertReply(v.membership.businessId, v.membership.memberId, id, await readJson(req, replyInputSchema));
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  await deleteReply(v.membership.businessId, id);
  return NextResponse.json({ ok: true });
});
