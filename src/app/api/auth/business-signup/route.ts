import { NextResponse } from "next/server";
import { z } from "zod";
import { applyBusiness } from "@/features/auth/business-signup";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle } from "@/features/auth/guards";
import { bizRegNoSchema, emailSchema, nameSchema, passwordSchema, phoneSchema } from "@/features/auth/validation";
import { BUSINESS_CATEGORY_CODES } from "@/features/business/policy-defaults";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * POST /api/auth/business-signup — 사업자 가입 신청 (FR-AUTH-010).
 * User + Business(PENDING) + OWNER + 워크인 계정 생성 후 OTP 메일. 다음 단계는 /signup/business/verify.
 * CAPTCHA 는 1기 게이트(Basic Auth) 뒤라 생략 — 게이트를 내리는 시점(#12 도메인)에 Turnstile 을 붙인다.
 */
export const Body = z.object({
  email: emailSchema,
  password: passwordSchema,
  ownerName: nameSchema,
  phone: phoneSchema,
  businessName: z.string().trim().min(1, "상호를 입력해 주세요").max(100),
  bizRegNo: bizRegNoSchema,
  category: z.enum(BUSINESS_CATEGORY_CODES),
  address: z.string().trim().min(1, "주소를 입력해 주세요").max(300),
  addressDetail: z.string().trim().max(200).optional(),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const input = await readJson(req, Body);
  const r = await applyBusiness(input, requestMeta(req.headers));
  return NextResponse.json({ ok: true, businessId: r.businessId }, { status: 201 });
});
