import { NextResponse } from "next/server";
import { cleanupUnverifiedBusinesses } from "@/features/auth/business-signup";
import { safeEqualString } from "@/features/auth/crypto";

/**
 * POST /api/cron/cleanup-unverified — 미검증 사업자 신청 7일 경과 삭제 (FR-AUTH-010 정리 배치).
 * Cloud Scheduler → `Authorization: Bearer $CRON_SECRET`. 로컬은 `npm run job:cleanup-unverified`.
 * 매일 03:00 KST (다른 C 배치와 같은 창, FR-ADM-030).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqualString(header, `Bearer ${secret}`)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const deleted = await cleanupUnverifiedBusinesses();
  return NextResponse.json({ ok: true, deleted });
}
