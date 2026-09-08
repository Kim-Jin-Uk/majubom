import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError, requireUser } from "@/features/auth/guards";
import { beginTotpSetup } from "@/features/auth/totp";

/** POST /api/auth/totp/setup — ADMIN 이 아직 TOTP 를 등록하지 않았을 때 시크릿 발급. 활성화된 뒤에는 409 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  if (v.principal.globalRole !== "ADMIN") throw new HttpError(404, "NOT_FOUND");
  const r = await beginTotpSetup(v.uid, v.principal.name);
  if ("error" in r) throw new HttpError(409, r.error);
  return NextResponse.json(r);
});
