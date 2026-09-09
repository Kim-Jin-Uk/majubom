import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireUser } from "@/features/auth/guards";
import { createReservation, createReservationSchema } from "@/features/booking/create";
import { readJson } from "@/lib/api";

/**
 * POST /api/reservations — 예약 생성 (FR-BOOK-020). 로그인한 고객 본인 명의로만 만든다.
 *
 * 409 `SLOT_TAKEN` 이면 `alternatives` 로 가장 가까운 시각 3개를 함께 준다 — 위젯이 "방금 마감됐어요, 대신 이 시각은?" 을 보여줄 수 있게.
 * 409 `TOO_MANY_ACTIVE` 는 1인 동시 예약 한도(정책). 400 은 입력·정책 위반(지난 시각, 선행시간 미달 등)이다.
 * 워크인 대리 등록(FR-BOOK-070)은 콘솔 라우트에서 따로 — 여기는 고객 경로다.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireUser();
  const body = await readJson(req, createReservationSchema);
  const r = await createReservation(body, { uid: v.uid });
  return NextResponse.json(
    { ok: true, id: r.id, code: r.code, status: r.status, resourceId: r.resourceId, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
