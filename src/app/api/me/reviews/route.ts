import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { createReview } from "@/features/review/reviews";
import { reviewInputSchema } from "@/features/review/rules";
import { readJson } from "@/lib/api";

const bodySchema = z.object({ reservationId: z.uuid() }).and(reviewInputSchema);

/**
 * POST /api/me/reviews — 리뷰 작성 (FR-REV-010, #92).
 * 자격(완료·30일·워크인 제외·1건 1리뷰)은 서버가 다시 본다 — 화면 판정은 미리 보여 주는 것일 뿐이다.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const { reservationId, ...input } = await readJson(req, bodySchema);
  const r = await createReview(v.uid, reservationId, input);
  return NextResponse.json({ ok: true, ...r }, { status: 201 });
});
