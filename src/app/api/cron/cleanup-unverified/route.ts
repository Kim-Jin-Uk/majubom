import { NextResponse } from "next/server";
import { cleanupUnverifiedBusinesses } from "@/features/auth/business-signup";
import { safeEqualString } from "@/features/auth/crypto";

/**
 * POST /api/cron/cleanup-unverified — 미검증 사업자 신청 7일 경과 삭제 (FR-AUTH-010 정리 배치).
 * Cloud Scheduler → 헤더 `X-Cron-Secret: $CRON_SECRET` (02 §4 배치 규약). 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 로컬은 `npm run job:cleanup-unverified`. 매일 03:00 KST (다른 C 배치와 같은 창, FR-ADM-030).
 * 프록시의 Basic Auth 예외 경로(/api/cron/*)다 — 자체 인증이 있으니 게이트를 거치지 않는다.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const deleted = await cleanupUnverifiedBusinesses();
  return NextResponse.json({ ok: true, deleted });
}
