import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { transitionReservation } from "@/features/booking/transitions";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

const cancelSchema = z.object({ reason: z.string().trim().max(300, "사유는 300자 이내").optional().nullable() });

/**
 * PATCH /api/me/reservations/:id/cancel — 고객 본인 취소 (FR-BOOK-040).
 * `REQUESTED` 는 언제든, `CONFIRMED` 는 **예약 생성 시점에 스냅샷된** 취소 마감 전까지만 (409 `CANCEL_DEADLINE_PASSED`).
 * 마감 뒤에는 화면이 [문의하기]로 안내한다 — 여기서 뚫어 주지 않는다. 남의 예약 id 는 404.
 */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  // assertWritable 을 걸지 않는다 — 읽기 전용 표시는 **콘솔** 게이트(SUSPENDED 사업장)라 고객 경로와 무관하고,
  // 겸업 계정이 자기 사업장 정지 때문에 남의 가게 예약을 취소하지 못하게 되는 것도 막는다 (FR-ADM-020)
  const v = await requireUser();
  const id = uuidParam((await ctx.params).id);
  const body = await readJson(req, cancelSchema);
  const r = await transitionReservation(id, "CANCELED_BY_USER", { kind: "CUSTOMER", uid: v.uid }, { reason: body.reason, meta: requestMeta(req.headers) });
  return NextResponse.json({ ok: true, ...r });
});
