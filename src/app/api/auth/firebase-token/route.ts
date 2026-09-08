import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError, requireUser } from "@/features/auth/guards";
import { loadPrincipal } from "@/features/auth/principal";
import { mintChatToken } from "@/lib/firebase/admin";
import { flags } from "@/lib/flags";

/**
 * POST /api/auth/firebase-token — Firestore 채팅 접근용 커스텀 토큰 (FR-AUTH-030 표 2~5단계).
 * - 채팅 화면 첫 진입 시 호출한다 (로그인 시점 아님). SDK 갱신도 같은 엔드포인트를 거친다 → 우리 세션이 살아 있어야 한다
 * - 클레임은 JWT 스냅샷이 아니라 **DB 를 다시 읽어** 만든다 — 권한 회수가 15분을 기다리지 않게
 * - FEATURE_CHAT 이 꺼져 있으면 404 (08 §2.3)
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (!flags.chat) throw new HttpError(404, "NOT_FOUND");
  const v = await requireUser();
  const p = await loadPrincipal(v.uid);
  if (!p || p.userStatus !== "ACTIVE") throw new HttpError(401, "UNAUTHENTICATED");

  const m = p.membership && p.membership.memberStatus === "ACTIVE" && p.membership.businessStatus !== "BLOCKED" ? p.membership : null;
  const claims = {
    ...(m ? { businessId: m.businessId } : {}),
    canHandleChat: Boolean(m && (m.role === "OWNER" || m.permissions.handleChat === true)),
    admin: p.globalRole === "ADMIN" && v.mfa === "ok",
  };
  const token = await mintChatToken(v.uid, claims);
  return NextResponse.json({ token, expiresIn: 3600, claims }, { headers: { "Cache-Control": "no-store" } });
});
