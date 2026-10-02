import { NextResponse } from "next/server";
import { safeEqualString } from "@/features/auth/crypto";
import { expireSwaps } from "@/features/schedule/swaps";
import { sendReminders } from "@/features/notification/reminder";

/**
 * POST /api/cron/hourly — **매시 틱** (매시 정각).
 *
 * `README.md` "운영: 마이그레이션과 배치" 의 설계를 처음 실행에 옮긴 것이다. 잡을 셋으로 합치는 이유는
 * 비용보다 **운영 면적**이다 — 잡마다 시크릿·재시도·알림 설정이 따로라 하나가 조용히 멈춰도 모른다.
 * 여기 들어오는 것은 **한 시간 단위로 충분한 일**들이다:
 *   · 방문 리마인더 (FR-NOTI-010, 시작 24시간 전) — 창이 한 시간이라 주기와 맞아떨어진다
 *   · 근무 교대 72시간 무응답 만료 — 72시간짜리 시한에 분 단위는 의미가 없다
 *
 * **한 작업이 실패해도 다음은 돌린다.** 다만 응답은 500 이다 — Scheduler 재시도와 알림이 거기 걸려 있어,
 * 200 으로 삼키면 며칠씩 조용히 안 돈다. 둘 다 멱등이라 재시도가 무해하다
 * (리마인더는 발송 이력에 없는 건만, 교대 만료는 조건부 UPDATE).
 *
 * 인증은 헤더 `X-Cron-Secret` 하나. 틀리면 **404** — 엔드포인트 존재를 숨긴다.
 * 기존 `/api/cron/expire-swaps` 는 아직 남겨 둔다: Scheduler 를 먼저 옮겨야 한다(설계의 ①②단계).
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

  const steps = {
    reminders: await run(() => sendReminders()),
    expireSwaps: await run(() => expireSwaps()),
  };

  const failed = Object.entries(steps).filter(([, r]) => !r.ok);
  for (const [name, r] of failed) console.error(`[cron:hourly] ${name} 실패:`, (r as { error: string }).error);
  // 작업별 결과를 그대로 싣는다 — 어느 하나가 멈춘 것을 로그에서 바로 읽을 수 있게
  return NextResponse.json({ ok: failed.length === 0, steps }, { status: failed.length === 0 ? 200 : 500 });
}
