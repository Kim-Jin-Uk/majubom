import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { getPatterns, patternInputSchema, setPattern } from "@/features/schedule/work-schedules";
import { readJson, uuidParam } from "@/lib/api";
import { todayIn } from "@/lib/dates";

/** GET /api/console/work-schedules/:resourceId — 현재·예정·이력 패턴 (소속 멤버) · PUT — 새 패턴 적용 (OWNER, FR-SCH-020) */
export const GET = handle(async (_req, ctx) => {
  const v = await requireConsole();
  const rid = uuidParam((await ctx.params).resourceId);
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  return NextResponse.json(await getPatterns(v.membership.businessId, rid, todayIn(settings.timezone)));
});

export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const rid = uuidParam((await ctx.params).resourceId);
  const body = await readJson(req, patternInputSchema);
  return NextResponse.json({ ok: true, ...(await setPattern(v.membership.businessId, [rid], body)) });
});
