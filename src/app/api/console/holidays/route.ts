import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { createHoliday, holidayInputSchema, listHolidays } from "@/features/schedule/holidays";
import { readJson } from "@/lib/api";
import { todayIn } from "@/lib/dates";

/** GET /api/console/holidays — 휴무 규칙 목록 (소속 멤버) · POST — 등록 (OWNER, FR-SCH-010). 미래 예약 충돌 시 409 HOLIDAY_CONFLICT */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ holidays: await listHolidays(v.membership.businessId) });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, holidayInputSchema);
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  const r = await createHoliday(v.membership.businessId, body, todayIn(settings.timezone));
  return NextResponse.json({ ok: true, id: r.id, conflicts: r.conflicts }, { status: 201 });
});
