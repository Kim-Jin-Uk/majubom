import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireAdmin } from "@/features/auth/guards";
import { decideApplication, decisionSchema } from "@/features/admin/businesses";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/admin/applications/:id — 승인 · 반려 (FR-ADM-010).
 * 409: NOT_PENDING(이미 처리됨) · EMAIL_UNVERIFIED(검증 전 신청은 심사 대상이 아니다)
 */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireAdmin();
  const body = await readJson(req, decisionSchema);
  const r = await decideApplication(uuidParam((await ctx.params).id), body, { uid: v.uid }, requestMeta(req.headers));
  return NextResponse.json({ ok: true, ...r });
});
