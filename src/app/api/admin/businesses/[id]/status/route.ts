import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireAdmin } from "@/features/auth/guards";
import { setBusinessStatus, statusSchema } from "@/features/admin/businesses";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/admin/businesses/:id/status — 일시정지 · 차단 · 복구 (FR-ADM-020). 사유 필수.
 * 409: NOT_APPROVED(심사 전) · SAME_STATUS · LIVE_RESERVATIONS(차단인데 남은 예약이 있다 —
 *      `cancelReservations` 로 함께 취소하거나 `confirmReservations` 로 두고 진행)
 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireAdmin();
  const body = await readJson(req, statusSchema);
  const r = await setBusinessStatus(uuidParam((await ctx.params).id), body, { uid: v.uid }, requestMeta(req.headers));
  return NextResponse.json({ ok: true, ...r });
});
