import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyBusinessEmail } from "@/features/auth/business-signup";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { emailSchema, otpSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";

/** POST /api/auth/business-signup/verify { email, code } — OTP 검증 → Business.emailVerifiedAt. 성공 후 클라이언트가 로그인한다 */
const Body = z.object({ email: emailSchema, code: otpSchema });

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { email, code } = await readJson(req, Body);
  const r = await verifyBusinessEmail(email, code);
  if (!r.ok) throw new HttpError(400, `OTP_${r.reason}`);
  return NextResponse.json({ ok: true });
});
