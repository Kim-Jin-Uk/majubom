import { NextResponse } from "next/server";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { handle, HttpError, requireConsole } from "@/features/auth/guards";
import { consoleActor, listQuerySchema, listReservations } from "@/features/booking/console";
import { todayIn } from "@/lib/dates";

/**
 * GET /api/console/reservations — 예약 목록 (FR-BOOK-080, #60).
 * 기간·상태·자원·상품·경로·검색어로 거른다. 범위는 항상 내 사업장이고, 매니저는 `viewAllReservations` 가 없으면 본인 담당 자원 건만 본다(#63).
 * 커서는 `startAt|id` — 같은 시각 예약이 페이지 경계에 걸려도 건너뛰거나 겹치지 않는다.
 */
export const GET = handle(async (req) => {
  const v = await requireConsole();
  const u = new URL(req.url);
  const raw = {
    from: u.searchParams.get("from") ?? undefined,
    to: u.searchParams.get("to") ?? undefined,
    status: u.searchParams.getAll("status").length ? u.searchParams.getAll("status") : undefined,
    resourceId: u.searchParams.get("resourceId") ?? undefined,
    productId: u.searchParams.get("productId") ?? undefined,
    createdVia: u.searchParams.get("createdVia") ?? undefined,
    q: u.searchParams.get("q") ?? undefined,
    cursor: u.searchParams.get("cursor") ?? undefined,
    limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
  };
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "INVALID_QUERY", { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });

  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  const r = await listReservations(consoleActor(v), parsed.data, settings.timezone, todayIn(settings.timezone));
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
});
