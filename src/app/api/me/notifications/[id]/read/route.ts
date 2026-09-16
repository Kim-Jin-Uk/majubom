import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { markRead } from "@/features/notification/inbox";
import { uuidParam } from "@/lib/api";

/** PATCH /api/me/notifications/:id/read — 한 건 읽음 (FR-NOTI-030, #98). 남의 알림 id 는 조용히 아무 일도 없다 */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireUser();
  await markRead(v.uid, uuidParam((await ctx.params).id));
  return NextResponse.json({ ok: true });
});
