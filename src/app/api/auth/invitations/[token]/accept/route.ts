import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { acceptInvite } from "@/features/auth/members";
import { passwordSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";

/** POST /api/auth/invitations/:token/accept { password? } — 수락 (02 §4 API 표의 경로) */
export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const { token } = await ctx.params;
  const { password } = await readJson(req, z.object({ password: passwordSchema.optional() }));
  const r = await acceptInvite(token, password);
  if (!r.ok) throw new HttpError(400, `INVITE_${r.reason}`);
  return NextResponse.json({ ok: true, email: r.email });
});
