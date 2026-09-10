import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { businessInfoSchema, getBusinessSettings, updateBusinessInfo } from "@/features/business/settings";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";
import { revalidatePublicHome } from "@/features/site/revalidate";

/** GET /api/console/business — 사업장 기본정보·영업시간 (소속 멤버) · PATCH — 수정 (OWNER, FR-BIZ-010) */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ business: await getBusinessSettings(v.membership.businessId) });
});

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, businessInfoSchema);
  await updateBusinessInfo(v.membership.businessId, body, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers));
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true });
});
