import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { acceptInvite, previewInvite } from "@/features/auth/members";
import { passwordSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";

/** GET /api/auth/invite/:token — 초대 미리보기 · POST { password? } — 수락 (FR-AUTH-020) */
export const GET = handle(async (_req, ctx) => {
  const { token } = await ctx.params;
  const r = await previewInvite(token);
  if (!r.ok) throw new HttpError(400, `INVITE_${r.reason}`);
  return NextResponse.json(r);
});

export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const { token } = await ctx.params;
  const { password } = await readJson(req, z.object({ password: passwordSchema.optional() }));
  const r = await acceptInvite(token, password);
  if (!r.ok) throw new HttpError(400, `INVITE_${r.reason}`);
  return NextResponse.json({ ok: true, email: r.email });
});
