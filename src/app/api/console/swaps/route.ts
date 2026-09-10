import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { createSwap, listSwaps, swapInputSchema } from "@/features/schedule/swaps";
import { readJson } from "@/lib/api";

/**
 * GET  /api/console/swaps?open=1 — 내가 당사자인 교대 요청 (OWNER 는 전부)
 * POST /api/console/swaps       — 교대 요청 (FR-SHIFT-010). **본인 자원에서만** 낸다
 *
 * 409: SWAP_EXISTS(같은 두 사람·같은 날 진행 중) · NO_SHIFT_TO_SWAP(넘길 근무가 없다) ·
 *      TARGET_ALREADY_WORKING(GIVE 인데 대상이 그날 이미 근무) · SHIFT_CROSSES_MIDNIGHT
 */
export const GET = handle(async (req) => {
  const v = await requireConsole();
  const openOnly = new URL(req.url).searchParams.get("open") === "1";
  const swaps = await listSwaps(v.membership.businessId, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId }, { openOnly });
  return NextResponse.json({ swaps });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const body = await readJson(req, swapInputSchema);
  const r = await createSwap(v.membership.businessId, body, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId });
  return NextResponse.json({ ok: true, ...r }, { status: 201 });
});
