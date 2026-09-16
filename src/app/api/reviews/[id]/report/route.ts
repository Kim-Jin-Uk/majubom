import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { reportInputSchema, reportReview } from "@/features/review/reports";
import { readJson, uuidParam } from "@/lib/api";

/**
 * POST /api/reviews/:id/report — 리뷰 신고 접수 (FR-ADM-060, #94).
 * 로그인한 사람만 — 익명 신고를 받으면 한 사람이 같은 글을 몇 번이고 신고할 수 있다.
 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const id = uuidParam((await ctx.params).id);
  await reportReview(v.uid, id, await readJson(req, reportInputSchema));
  return NextResponse.json({ ok: true }, { status: 201 });
});
