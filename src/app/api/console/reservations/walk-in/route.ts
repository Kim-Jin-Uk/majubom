import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { walkinEmail } from "@/features/auth/business-signup";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, HttpError, requireConsole } from "@/features/auth/guards";
import { createWalkIn, walkInSchema } from "@/features/booking/create";
import { ownResourceId } from "@/features/schedule/work-exceptions";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/console/reservations/walk-in — 워크인 대리 등록 (FR-BOOK-070).
 * OWNER 전체 / MANAGER 는 **본인 자원 건만** (타인 자원 슬롯을 임의로 점유하는 것을 막는다).
 * 고객은 사업장별 워크인 내부 계정(`walkin+{businessId}@internal`)이고, 받아 적은 이름은 `guestLabel` 에 표시용으로만 남는다.
 * 정책(선행시간·예약 가능일·1인 한도)은 우회하되 **자원 시간 충돌 검증은 동일**하다. 즉시 CONFIRMED.
 * 리뷰 자격은 `createdVia = WALK_IN` 으로 걸러진다 (FR-REV-010) — 연락처 검증 없이 만든 예약으로 리뷰를 쌓을 수 없게.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const body = await readJson(req, walkInSchema);
  const businessId = v.membership.businessId;
  if (v.membership.role !== "OWNER") {
    const mine = await ownResourceId(businessId, v.membership.memberId);
    if (body.resourceId !== mine) throw new HttpError(403, "NOT_OWN_RESOURCE");
  }
  const [walkIn] = await db.select({ id: users.id }).from(users).where(eq(users.email, walkinEmail(businessId))).limit(1);
  if (!walkIn) throw new HttpError(409, "NO_WALKIN_ACCOUNT");

  // 상품·자원이 이 사업장 것인지는 createWalkIn 이 확인한다 (상품에서 businessId 를 읽어 저장하므로 여기서만 막으면 샌다)
  const r = await createWalkIn(body, { customerId: walkIn.id, businessId });
  await writeAudit({
    action: "RESERVATION_CREATE_WALKIN",
    actorId: v.uid,
    actorRole: v.membership.role,
    businessId,
    targetType: "RESERVATION",
    targetId: r.id,
    diff: { code: r.code, resourceId: r.resourceId, startAt: r.startAt.toISOString(), partySize: body.partySize },
    meta: requestMeta(req.headers),
  });
  return NextResponse.json({ ok: true, id: r.id, code: r.code, status: r.status, resourceId: r.resourceId, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString() }, { status: 201 });
});
