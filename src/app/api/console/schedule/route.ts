import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireConsole } from "@/features/auth/guards";
import { getScheduleGrid } from "@/features/schedule/calendar";

const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /api/console/schedule?from&to[&resourceId=…] — 자원 × 날짜 근무 그리드 + 요약 (FR-SCH-030). 최대 62일 */
export const GET = handle(async (req) => {
  const v = await requireConsole();
  const u = new URL(req.url);
  const from = dateQ.safeParse(u.searchParams.get("from"));
  const to = dateQ.safeParse(u.searchParams.get("to"));
  if (!from.success || !to.success) throw new HttpError(400, "INVALID_RANGE");
  const resourceIds = u.searchParams.getAll("resourceId").filter((x) => z.uuid().safeParse(x).success);
  return NextResponse.json(await getScheduleGrid(v.membership.businessId, from.data, to.data, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId }, { resourceIds }));
});
