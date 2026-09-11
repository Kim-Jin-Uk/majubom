import { NextResponse } from "next/server";
import { safeEqualString } from "@/features/auth/crypto";
import { expireSwaps } from "@/features/schedule/swaps";

/**
 * POST /api/cron/expire-swaps — 교대 요청 72시간 무응답 만료 (FR-SHIFT-010). 시간당 1회로 충분하다 —
 * 72시간짜리 시한에 분 단위 정확도는 의미가 없고, 응답을 기다리는 동안에는 근무표가 그대로다.
 * Cloud Scheduler → 헤더 `X-Cron-Secret: $CRON_SECRET`. 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 조건부 UPDATE 라 재실행이 무해하다(그 사이 수락·철회된 건은 건너뛴다).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const changed = await expireSwaps();
  return NextResponse.json({ ok: true, changed });
}
