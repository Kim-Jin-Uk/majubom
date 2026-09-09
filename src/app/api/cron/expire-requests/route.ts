import { NextResponse } from "next/server";
import { expireRequests } from "@/features/booking/transitions";
import { safeEqualString } from "@/features/auth/crypto";

/**
 * POST /api/cron/expire-requests — C2 승인 대기 만료 (5분 주기). REQUESTED 가 슬롯을 무기한 묶어 두지 않게 주기를 짧게 둔다.
 * Cloud Scheduler → 헤더 `X-Cron-Secret: $CRON_SECRET`. 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 조건부 UPDATE 라 재실행이 무해하다(그 사이 다른 전이가 일어난 건은 409 로 건너뛴다).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const changed = await expireRequests();
  return NextResponse.json({ ok: true, changed });
}
