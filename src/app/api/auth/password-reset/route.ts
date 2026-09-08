import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle } from "@/features/auth/guards";
import { requestPasswordReset } from "@/features/auth/password-reset";
import { emailSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/** POST /api/auth/password-reset { email } — 항상 200 "메일을 보냈습니다" (FR-AUTH-040 열거 방지) */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { email } = await readJson(req, z.object({ email: emailSchema }));
  await requestPasswordReset(email, requestMeta(req.headers)).catch((e) => console.error("[password-reset] request failed:", (e as Error).message));
  return NextResponse.json({ ok: true });
});
