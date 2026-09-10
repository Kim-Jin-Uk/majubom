import { NextResponse } from "next/server";
import { cleanupUnverifiedBusinesses } from "@/features/auth/business-signup";
import { purgeExpiredSelections } from "@/features/booking/widget/selection";
import { safeEqualString } from "@/features/auth/crypto";

/**
 * POST /api/cron/cleanup-unverified — 만료 데이터 정리 배치.
 *   · 미검증 사업자 신청 7일 경과 삭제 (FR-AUTH-010)
 *   · 만료된 예약 위젯 선택 토큰 (#83) — 30분짜리라 하루 한 번이면 넉넉하다. 별 배치를 하나 더 만들 이유가 없다
 * Cloud Scheduler → 헤더 `X-Cron-Secret: $CRON_SECRET` (02 §4 배치 규약). 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 로컬은 `npm run job:cleanup-unverified`. 매일 03:00 KST (다른 C 배치와 같은 창, FR-ADM-030).
 * 프록시의 Basic Auth 예외 경로(/api/cron/*)다 — 자체 인증이 있으니 게이트를 거치지 않는다.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const deleted = await cleanupUnverifiedBusinesses();
  // 선택 토큰 정리는 실패해도 배치를 세우지 않는다 — 만료분이 하루 더 남는 것과 신청 정리가 안 도는 것은 무게가 다르다
  const selections = await purgeExpiredSelections().catch((e) => {
    console.error("[cron] 선택 토큰 정리 실패:", (e as Error).message);
    return 0;
  });
  return NextResponse.json({ ok: true, deleted, selections });
}
