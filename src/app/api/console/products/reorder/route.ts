import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { reorderProducts } from "@/features/product/products";
import { readJson } from "@/lib/api";

const Body = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

/** PUT /api/console/products/reorder — 표시 순서 (OWNER) */
export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { ids } = await readJson(req, Body);
  await reorderProducts(v.membership.businessId, ids);
  return NextResponse.json({ ok: true });
});
