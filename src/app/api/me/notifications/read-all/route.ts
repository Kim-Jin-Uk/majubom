import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { markAllRead } from "@/features/notification/inbox";

/** PATCH /api/me/notifications/read-all — 모두 읽음 (FR-NOTI-030, #98) */
export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  return NextResponse.json({ ok: true, read: await markAllRead(v.uid) });
});
