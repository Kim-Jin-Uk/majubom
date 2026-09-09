import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireConsole } from "@/features/auth/guards";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { getScheduleGrid } from "@/features/schedule/calendar";
import { isoDateSchema, todayIn } from "@/lib/dates";

const dateQ = isoDateSchema;

/** GET /api/console/schedule?from&to[&resourceId=…] — 자원 × 날짜 근무 그리드 + 요약 + 휴가 신청 목록 (FR-SCH-030). 최대 62일 */
export const GET = handle(async (req) => {
  const v = await requireConsole();
  const u = new URL(req.url);
  const from = dateQ.safeParse(u.searchParams.get("from"));
  const to = dateQ.safeParse(u.searchParams.get("to"));
  if (!from.success || !to.success) throw new HttpError(400, "INVALID_RANGE");
  const resourceIds = u.searchParams.getAll("resourceId").filter((x) => z.uuid().safeParse(x).success);
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  return NextResponse.json(await getScheduleGrid(v.membership.businessId, from.data, to.data, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId }, { resourceIds, today: todayIn(settings.timezone) }));
});
