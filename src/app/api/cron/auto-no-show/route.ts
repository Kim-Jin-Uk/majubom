import { NextResponse } from "next/server";
import { autoNoShow } from "@/features/booking/transitions";
import { safeEqualString } from "@/features/auth/crypto";

/**
 * POST /api/cron/auto-no-show — C3 노쇼 자동 전환 (일 1회 04:00). 종료 후 autoNoShowAfterHours 를 넘긴 CONFIRMED 를 NO_SHOW(AUTO) 로.
 * Cloud Scheduler → 헤더 `X-Cron-Secret: $CRON_SECRET`. 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 조건부 UPDATE 라 재실행이 무해하다(그 사이 다른 전이가 일어난 건은 409 로 건너뛴다).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const changed = await autoNoShow();
  return NextResponse.json({ ok: true, changed });
}
