import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { deleteHoliday } from "@/features/schedule/holidays";
import { uuidParam } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

/** DELETE /api/console/holidays/:id (OWNER) */
export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  await deleteHoliday(v.membership.businessId, uuidParam((await ctx.params).id));
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true });
});
