import { NextResponse } from "next/server";
import { z } from "zod";
import { unstable_update } from "@/features/auth/auth";
import { serverProof } from "@/features/auth/crypto";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError, requireUser } from "@/features/auth/guards";
import { verifyTotp } from "@/features/auth/totp";
import { otpSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/auth/totp/verify { code } — 코드 검증 → JWT mfa=ok.
 * JWT 변경은 unstable_update({ mfaProof }) 로 하고, jwt 콜백은 sid 에 묶인 HMAC 증명을 검사한다 (클라이언트가 세션
 * update 엔드포인트를 직접 불러 mfa 를 올릴 수 없다).
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  if (v.principal.globalRole !== "ADMIN") throw new HttpError(404, "NOT_FOUND");
  if (!v.sid) throw new HttpError(401, "UNAUTHENTICATED");
  const { code } = await readJson(req, z.object({ code: otpSchema }));
  const r = await verifyTotp(v.uid, code, requestMeta(req.headers));
  if (!r.ok) {
    if (r.reason === "LOCKED") throw new HttpError(429, "RATE_LIMITED", { retryAfterSec: r.retryAfterSec });
    throw new HttpError(400, `TOTP_${r.reason}`);
  }
  await unstable_update({ mfaProof: serverProof("mfa", v.sid, process.env.AUTH_SECRET ?? "") } as never);
  return NextResponse.json({ ok: true, enabledNow: r.enabledNow });
});
