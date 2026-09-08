import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { removeResource, resourceInputSchema, updateResource } from "@/features/business/resources";
import { readJson } from "@/lib/api";

/** PUT /api/console/resources/:id — 수정 · DELETE — 삭제(예약 이력 있으면 비활성화로 대체, 결과 mode 로 알림) (OWNER) */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { id } = await ctx.params;
  const body = await readJson(req, resourceInputSchema);
  await updateResource(v.membership.businessId, id, body);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { id } = await ctx.params;
  return NextResponse.json(await removeResource(v.membership.businessId, id));
});
