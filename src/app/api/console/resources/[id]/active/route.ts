import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { setResourceActive } from "@/features/business/resources";
import { readJson, uuidParam } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

const Body = z.object({ isActive: z.boolean() });

/** PATCH /api/console/resources/:id/active — 활성/비활성 토글 (OWNER). 비활성 자원은 신규 예약 대상에서 빠진다 */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const id = uuidParam((await ctx.params).id);
  const { isActive } = await readJson(req, Body);
  await setResourceActive(v.membership.businessId, id, isActive);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true });
});
