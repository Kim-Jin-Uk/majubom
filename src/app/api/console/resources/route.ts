import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { createResource, listResources, resourceInputSchema } from "@/features/business/resources";
import { readJson } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

/** GET /api/console/resources — 자원 목록 (소속 멤버) · POST — 등록 (OWNER, FR-RES-010) */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ resources: await listResources(v.membership.businessId) });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, resourceInputSchema);
  const r = await createResource(v.membership.businessId, body);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
});
