import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { deleteHoliday } from "@/features/schedule/holidays";
import { uuidParam } from "@/lib/api";

/** DELETE /api/console/holidays/:id (OWNER) */
export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  await deleteHoliday(v.membership.businessId, uuidParam((await ctx.params).id));
  return NextResponse.json({ ok: true });
});
