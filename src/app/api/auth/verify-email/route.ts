import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { consumeToken } from "@/features/auth/tokens";
import { absoluteUrl } from "@/lib/api";

/**
 * GET /api/auth/verify-email?token= — 고객 이메일 검증 링크 (메일에서 클릭). 결과는 /login?verified=… 로 보여준다.
 * GET 이지만 상태를 바꾼다: 메일 클라이언트의 링크 미리보기(프리페치)가 토큰을 소비할 수 있다는 것을 안다 —
 * 그 경우에도 결과는 "검증됨" 이므로 사용자에게 손해가 없다.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const r = await consumeToken("EMAIL_VERIFY", token);
  if (!r.ok) return NextResponse.redirect(absoluteUrl(`/login?verified=${r.reason.toLowerCase()}`));
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, r.userId));
  return NextResponse.redirect(absoluteUrl("/login?verified=ok"));
}
