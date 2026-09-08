import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError, requireUser } from "@/features/auth/guards";
import { revokeSession } from "@/features/auth/session-store";

/** DELETE /api/me/sessions/:id — 세션 하나 폐기 (본인 것만; 남의 id 는 404). 현재 기기면 클라이언트가 이어서 signOut 한다 */
export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "NOT_FOUND");
  const ok = await revokeSession(id, v.uid);
  if (!ok) throw new HttpError(404, "NOT_FOUND");
  return NextResponse.json({ ok: true, current: id === v.sid });
});
