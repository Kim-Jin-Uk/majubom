import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { confirmPasswordReset, previewPasswordReset } from "@/features/auth/password-reset";
import { passwordSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/** GET ?token= 상태 미리보기 · POST { token, password } 재설정 */
export const GET = handle(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const r = await previewPasswordReset(token);
  if (!r.ok) throw new HttpError(400, `TOKEN_${r.reason}`);
  return NextResponse.json({ ok: true });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { token, password } = await readJson(req, z.object({ token: z.string().min(20).max(200), password: passwordSchema }));
  const r = await confirmPasswordReset(token, password, requestMeta(req.headers));
  if (!r.ok) throw new HttpError(400, `TOKEN_${r.reason}`);
  return NextResponse.json({ ok: true });
});
