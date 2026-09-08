import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { EMAIL_VERIFY_TTL_HOURS } from "@/features/auth/constants";
import { hashPassword } from "@/features/auth/crypto";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError } from "@/features/auth/guards";
import { issueToken } from "@/features/auth/tokens";
import { emailSchema, nameSchema, passwordSchema } from "@/features/auth/validation";
import { absoluteUrl, readJson } from "@/lib/api";
import { sendMail } from "@/lib/mail";
import { emailVerifyMail } from "@/lib/mail/templates";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/auth/signup — 고객 이메일 가입 (FR-AUTH-030 "이메일 로그인: 자체").
 * 가입 즉시 로그인 가능. 이메일 검증은 비동기 링크 — 검증 전에는 MARKETING 알림만 보류된다.
 * 성공 후 클라이언트가 credentials 로그인을 이어서 호출한다 (여기서 세션을 만들지 않는다 — Auth.js 경로 하나로 통일).
 */
const Body = z.object({ email: emailSchema, password: passwordSchema, name: nameSchema });

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { email, password, name } = await readJson(req, Body);
  const meta = requestMeta(req.headers);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new HttpError(409, "EMAIL_TAKEN");

  const passwordHash = await hashPassword(password);
  const [u] = await db.insert(users).values({ email, name, passwordHash, provider: "LOCAL" }).returning({ id: users.id });

  const raw = await issueToken("EMAIL_VERIFY", u.id, meta.ip);
  await sendMail(emailVerifyMail(email, absoluteUrl(`/api/auth/verify-email?token=${raw}`), EMAIL_VERIFY_TTL_HOURS)).catch((e) =>
    console.error("[signup] verify mail failed:", (e as Error).message),
  );
  return NextResponse.json({ ok: true }, { status: 201 });
});
