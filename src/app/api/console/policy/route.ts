import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { getPolicy, policySchema, updatePolicy } from "@/features/business/policy";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/** GET /api/console/policy — 예약 정책 · PUT — 전체 교체 (OWNER, FR-BIZ-020). 변경 필드만 감사 diff */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ policy: await getPolicy(v.membership.businessId) });
});

export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, policySchema);
  const policy = await updatePolicy(v.membership.businessId, body, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers));
  return NextResponse.json({ ok: true, policy });
});
