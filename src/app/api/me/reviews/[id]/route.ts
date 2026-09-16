import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { deleteReview, updateReview } from "@/features/review/reviews";
import { reviewInputSchema } from "@/features/review/rules";
import { readJson, uuidParam } from "@/lib/api";

/**
 * PUT/DELETE /api/me/reviews/:id — 본인 리뷰 수정(7일 이내 1회) · 삭제(soft) (FR-REV-010, #92).
 * 남의 리뷰 id 는 404 — 존재를 알리지 않는다.
 */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const id = uuidParam((await ctx.params).id);
  await updateReview(v.uid, id, await readJson(req, reviewInputSchema));
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const id = uuidParam((await ctx.params).id);
  await deleteReview(v.uid, id);
  return NextResponse.json({ ok: true });
});
