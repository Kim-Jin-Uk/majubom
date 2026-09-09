import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { transitionInputSchema, transitionReservation } from "@/features/booking/transitions";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * PATCH /api/console/reservations/:id/status — 상태 전이 (FR-BOOK-030 승인·거절 / FR-BOOK-040 매장 취소 / FR-BOOK-060 완료·노쇼).
 * OWNER 전체, MANAGER 는 본인 담당 자원 건만. 허용되지 않은 전이는 409 `INVALID_TRANSITION` — 표는 features/booking/transitions.ts 하나뿐이다.
 * 거절·매장 취소·교정(COMPLETED ↔ NO_SHOW)은 사유 필수(400 `REASON_REQUIRED`), 교정은 OWNER 만.
 * 정지(SUSPENDED)된 사업장의 콘솔은 읽기 전용이지만 매장 취소만은 열어 둔다 (FR-ADM-020).
 */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  const body = await readJson(req, transitionInputSchema);
  // SUSPENDED 사업장의 콘솔은 읽기 전용이지만 **예약 취소는 예외** (FR-ADM-020 — 고객에게 연락할 수단을 막으면 피해가 고객에게 간다)
  if (body.status !== "CANCELED_BY_BIZ") assertWritable(req);
  const r = await transitionReservation(
    id,
    body.status,
    { kind: "CONSOLE", uid: v.uid, role: v.membership.role, memberId: v.membership.memberId, businessId: v.membership.businessId },
    { reason: body.reason, meta: requestMeta(req.headers) },
  );
  return NextResponse.json({ ok: true, ...r });
});
