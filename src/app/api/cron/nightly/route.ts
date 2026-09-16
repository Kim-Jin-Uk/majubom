import { NextResponse } from "next/server";
import { safeEqualString } from "@/features/auth/crypto";
import { purgeOldNotifications } from "@/features/notification/inbox";

/**
 * POST /api/cron/nightly — **야간 틱** (03:00 KST).
 *
 * `README.md` "운영: 마이그레이션과 배치" 설계의 세 번째 틱이다. 지금 들어 있는 단계는 하나뿐이다:
 *   · 30일 지난 알림 정리 (FR-NOTI-030)
 *
 * **비어 있는 채로 만들지 않았다.** 알림함 화면이 "30일이 지나면 자동으로 정리돼요" 라고 말하는데
 * 그걸 실제로 하는 것이 아무 데도 없었다(리뷰 지적). 화면이 거짓말을 하느니 틱을 하나 먼저 낸다.
 *
 * 나머지 단계(사용량 집계 #67 · 자동 노쇼 · 미검증 정리 · 마스킹 · 채팅 정리)는 설계대로 여기 모인다.
 * 그때도 규약은 같다: **순서는 집계 → 상태 변경 → 삭제·마스킹**, 한 작업이 실패해도 다음은 돌리되 응답은 500.
 */
type StepResult = { ok: true; changed: number } | { ok: false; error: string };

async function run(fn: () => Promise<number>): Promise<StepResult> {
  try {
    return { ok: true, changed: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !header || !safeEqualString(header, secret)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const steps = { purgeNotifications: await run(() => purgeOldNotifications()) };
  const failed = Object.entries(steps).filter(([, r]) => !r.ok);
  for (const [name, r] of failed) console.error(`[cron:nightly] ${name} 실패:`, (r as { error: string }).error);
  return NextResponse.json({ ok: failed.length === 0, steps }, { status: failed.length === 0 ? 200 : 500 });
}
