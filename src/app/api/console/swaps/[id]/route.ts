import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { actOnSwap, swapActionSchema } from "@/features/schedule/swaps";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/console/swaps/:id — 수락 · 거절 · 철회 · 승인 · 거부 (FR-SHIFT-020).
 * 전이 하나에 라우트 하나를 두지 않는다 — 표(`swap-rules.ts`)가 누가 무엇을 할 수 있는지 이미 정한다.
 *
 * 409: INVALID_SWAP_ACTION(그 상태에서 못 하는 동작) · SWAP_RESERVATIONS_CHANGED(요청 뒤 예약이 바뀌었다) ·
 *      SWAP_CONFLICT(옮길 수 없는 예약) · SWAP_DIRECT_PICKS(고객이 담당자를 지정한 예약 — confirmDirectPicks 로 확인)
 * 당사자도 사장님도 아니면 404 — 남의 교대는 존재를 알리지 않는다
 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const body = await readJson(req, swapActionSchema);
  const r = await actOnSwap(
    v.membership.businessId,
    uuidParam((await ctx.params).id),
    body,
    { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId },
    requestMeta(req.headers),
  );
  return NextResponse.json({ ok: true, ...r });
});
