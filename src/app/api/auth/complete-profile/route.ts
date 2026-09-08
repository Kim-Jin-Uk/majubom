import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, unstable_update } from "@/features/auth/auth";
import { EMAIL_VERIFY_TTL_HOURS } from "@/features/auth/constants";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { completePendingProfile } from "@/features/auth/oauth-account";
import { issueToken } from "@/features/auth/tokens";
import { emailSchema, nameSchema } from "@/features/auth/validation";
import { absoluteUrl, readJson } from "@/lib/api";
import { sendMail } from "@/lib/mail";
import { emailVerifyMail } from "@/lib/mail/templates";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/auth/complete-profile — 소셜 로그인이 이메일을 주지 않은 사용자의 가입 마무리 (FR-AUTH-030 이메일 필수).
 * pending 세션(JWT 에 pending 만 있고 uid 없음)에서만 동작. 사용자 생성 → unstable_update({ bindUid }) 로 세션 확립.
 * jwt 콜백은 bindUid 의 (provider, providerAccountId) 가 pending 과 일치할 때만 받아준다.
 */
const Body = z.object({ email: emailSchema, name: nameSchema });

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const s = await auth();
  if (!s?.pending || s.user.id) throw new HttpError(409, "NOT_PENDING");
  const { email, name } = await readJson(req, Body);

  const r = await completePendingProfile(s.pending, email, name);
  if ("error" in r) throw new HttpError(409, "EMAIL_TAKEN");

  await unstable_update({ bindUid: r.uid } as never);

  const raw = await issueToken("EMAIL_VERIFY", r.uid, requestMeta(req.headers).ip);
  await sendMail(emailVerifyMail(email, absoluteUrl(`/api/auth/verify-email?token=${raw}`), EMAIL_VERIFY_TTL_HOURS)).catch((e) =>
    console.error("[complete-profile] verify mail failed:", (e as Error).message),
  );
  return NextResponse.json({ ok: true });
});
