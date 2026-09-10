import { NextResponse } from "next/server";
import { handle, HttpError, requireAdmin } from "@/features/auth/guards";
import { listApplications, listQuerySchema } from "@/features/admin/businesses";

/** GET /api/admin/applications?status&q — 가입 심사 큐 (FR-ADM-010). 기본은 대기 중 · 이메일 검증된 신청만 */
export const GET = handle(async (req) => {
  await requireAdmin();
  const u = new URL(req.url);
  const parsed = listQuerySchema.safeParse({ status: u.searchParams.get("status") ?? undefined, q: u.searchParams.get("q") ?? undefined });
  if (!parsed.success) throw new HttpError(400, "INVALID_QUERY", { issues: parsed.error.issues });
  return NextResponse.json({ applications: await listApplications(parsed.data) });
});
