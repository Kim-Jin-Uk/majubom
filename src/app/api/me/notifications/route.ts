import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, requireUser } from "@/features/auth/guards";
import { preferenceInputSchema } from "@/features/me/notification-rules";
import { loadPreferences, savePreference } from "@/features/me/profile";
import { readJson } from "@/lib/api";

/**
 * 알림 채널 설정 (FR-NOTI-030, #90).
 *
 * PUT 은 **한 그룹씩** 받는다. 네 그룹을 한 번에 받으면 화면이 스위치 하나를 누를 때마다 네 줄을 다시 쓰고,
 * 두 탭이 동시에 열려 있으면 오래된 탭의 값이 다른 그룹까지 되돌린다.
 */
export const GET = handle(async () => {
  const v = await requireUser();
  return NextResponse.json({ items: await loadPreferences(v.uid) });
});

export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  const v = await requireUser();
  const input = await readJson(req, preferenceInputSchema);
  await savePreference(v.uid, input);
  // 저장된 값을 돌려준다 — 인앱 잠금처럼 서버가 고쳐 쓰는 값이 있어 화면이 제 값을 믿으면 어긋난다
  return NextResponse.json({ items: await loadPreferences(v.uid) });
});
