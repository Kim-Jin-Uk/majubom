import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, HttpError, requireConsole } from "@/features/auth/guards";
import { createException, exceptionInputSchema, listExceptions } from "@/features/schedule/work-exceptions";
import { readJson } from "@/lib/api";

const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * GET /api/console/work-exceptions?from&to — 기간의 근무 예외 (소속 멤버; 사유는 본인·OWNER 만)
 * POST — 등록. OWNER 는 모든 종류·모든 담당자(충돌 시 409 EXCEPTION_CONFLICT, confirmConflicts 로 강행), MANAGER 는 본인 BLOCK 만(예약 있으면 409 BLOCK_HAS_RESERVATIONS)
 */
export const GET = handle(async (req) => {
  const v = await requireConsole();
  const u = new URL(req.url);
  const from = dateQ.safeParse(u.searchParams.get("from"));
  const to = dateQ.safeParse(u.searchParams.get("to"));
  if (!from.success || !to.success) throw new HttpError(400, "INVALID_RANGE");
  return NextResponse.json({ exceptions: await listExceptions(v.membership.businessId, from.data, to.data, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId }) });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const body = await readJson(req, exceptionInputSchema);
  const r = await createException(v.membership.businessId, body, { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId });
  return NextResponse.json({ ok: true, id: r.id, conflicts: r.conflicts }, { status: 201 });
});
