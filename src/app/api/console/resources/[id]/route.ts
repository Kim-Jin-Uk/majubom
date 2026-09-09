import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { removeResource, resourceInputSchema, updateResource } from "@/features/business/resources";
import { readJson, uuidParam } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

/** PUT /api/console/resources/:id — 수정 · DELETE — 삭제(예약 이력 있으면 비활성화로 대체, 결과 mode 로 알림) (OWNER) */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const id = uuidParam((await ctx.params).id);
  const body = await readJson(req, resourceInputSchema);
  await updateResource(v.membership.businessId, id, body);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const id = uuidParam((await ctx.params).id);
  // 지운 뒤에 — 마지막 자원을 비활성화하면 공개 홈이 404 로 바뀌어야 하는데, 먼저 부르면 살아 있는 상태로 다시 굽는다
  const r = await removeResource(v.membership.businessId, id);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json(r);
});
