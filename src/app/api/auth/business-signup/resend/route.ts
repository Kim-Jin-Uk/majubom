import { NextResponse } from "next/server";
import { z } from "zod";
import { resendBusinessOtp } from "@/features/auth/business-signup";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle } from "@/features/auth/guards";
import { emailSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/** POST /api/auth/business-signup/resend { email } — OTP 재발송. 계정 유무를 드러내지 않는다 (항상 200) */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { email } = await readJson(req, z.object({ email: emailSchema }));
  await resendBusinessOtp(email, requestMeta(req.headers));
  return NextResponse.json({ ok: true });
});
