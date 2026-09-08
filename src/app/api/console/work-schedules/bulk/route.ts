import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { bulkPatternInputSchema, setPattern } from "@/features/schedule/work-schedules";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { readJson } from "@/lib/api";
import { todayIn } from "@/lib/dates";

/** PUT /api/console/work-schedules/bulk — 여러 담당자에게 같은 패턴 (OWNER, FR-SCH-020 일괄 편집) */
export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { resourceIds, ...body } = await readJson(req, bulkPatternInputSchema);
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  return NextResponse.json({ ok: true, ...(await setPattern(v.membership.businessId, resourceIds, body, todayIn(settings.timezone))) });
});
