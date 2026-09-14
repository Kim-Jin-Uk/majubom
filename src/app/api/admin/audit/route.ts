import { NextResponse } from "next/server";
import { handle, HttpError, requireAdmin } from "@/features/auth/guards";
import { auditQuerySchema, listAuditLogs, usedActions } from "@/features/admin/audit";

/**
 * GET /api/admin/audit?action&business&actor&from&to&cursor — 감사 로그 조회 (FR-ADM-040, #68).
 *
 * 읽기 전용이다. **여기서 감사 로그를 남기지 않는다** — 조회 자체를 기록하면 로그가 조회로 불어난다.
 * (신고 열람은 다르다: `REPORT_VIEW` 는 남긴다. 그건 개인정보를 여는 행위라 누가 봤는지가 증거다.)
 */
export const GET = handle(async (req) => {
  await requireAdmin();
  const u = new URL(req.url);
  const raw = Object.fromEntries([...u.searchParams.entries()].filter(([, v]) => v !== ""));
  const parsed = auditQuerySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "INVALID_QUERY", { issues: parsed.error.issues });
  // **"더 보기" 에서는 행위 목록을 다시 세지 않는다.** 전체 테이블 groupBy 라 로그가 커지면 무거워지는데,
  // 이어 읽기 중에 필터 선택지가 바뀔 일도 없다 — 첫 조회에서만 센다 (리뷰 지적)
  const [page, actions] = await Promise.all([listAuditLogs(parsed.data), parsed.data.cursor ? null : usedActions()]);
  return NextResponse.json(actions ? { ...page, actions } : page);
});
