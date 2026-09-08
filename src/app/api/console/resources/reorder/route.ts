import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { reorderResources } from "@/features/business/resources";
import { readJson } from "@/lib/api";

const Body = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

/** PUT /api/console/resources/reorder — 표시 순서 (OWNER). 배열 순서 = sort_order */
export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { ids } = await readJson(req, Body);
  await reorderResources(v.membership.businessId, ids);
  return NextResponse.json({ ok: true });
});
