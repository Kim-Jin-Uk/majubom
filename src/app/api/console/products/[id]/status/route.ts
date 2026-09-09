import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { setProductStatus } from "@/features/product/products";
import { readJson, uuidParam } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

const Body = z.object({ status: z.enum(["DRAFT", "ACTIVE", "HIDDEN"]) });

/** PATCH /api/console/products/:id/status — 노출 상태 (OWNER). ARCHIVED 복구는 없다 */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const id = uuidParam((await ctx.params).id);
  const { status } = await readJson(req, Body);
  await setProductStatus(v.membership.businessId, id, status);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true });
});
