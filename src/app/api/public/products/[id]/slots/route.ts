import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/features/auth/guards";
import { loadSlotContext } from "@/features/booking/context";
import { computeSlots } from "@/features/booking/slots";
import { isSlotFailure, type SlotSuccess } from "@/features/booking/slot-types";
import { uuidParam } from "@/lib/api";
import { dateRange } from "@/features/schedule/resolve";
import { isoDateSchema } from "@/lib/dates";

/**
 * GET /api/public/products/:id/slots?date=YYYY-MM-DD[&to=YYYY-MM-DD][&partySize=][&durationMin=][&resourceId=]
 * — FR-BOOK-010 가용 슬롯 조회 (로그인 없이 열려 있다. 1기에는 프록시 Basic Auth 게이트 뒤).
 *
 * 하루 또는 기간(최대 31일). 기간이어도 DB 는 한 번만 읽고(`loadSlotContext`) 날짜별로 순수 함수를 돌린다.
 * 계산 결과는 캐시하지 않는다 — partySize·durationMin·resourceId 에 따라 달라지므로(명세 성능 절) 캐시는 원본 구간·점유에만 붙인다.
 * `AUTO` 상품은 자원 배정을 서버가 하므로 응답에서 `resourceIds` 를 지운다 (FR-PRD-010 "고객에게 미노출", 가정 A6).
 */
const MAX_DAYS = 31;

export const GET = handle(async (req, ctx) => {
  const id = uuidParam((await ctx.params).id);
  const u = new URL(req.url);
  const from = isoDateSchema.safeParse(u.searchParams.get("date"));
  const toRaw = u.searchParams.get("to");
  const to = toRaw ? isoDateSchema.safeParse(toRaw) : from;
  if (!from.success || !to.success) throw new HttpError(400, "INVALID_RANGE");
  const dates = dateRange(from.data, to.data);
  if (dates.length === 0 || dates.length > MAX_DAYS) throw new HttpError(400, "INVALID_RANGE", { maxDays: MAX_DAYS });

  const num = (k: string, dflt?: number) => {
    const raw = u.searchParams.get(k);
    if (raw === null) return dflt;
    const n = z.coerce.number().int().positive().safeParse(raw);
    if (!n.success) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: [k], message: "양의 정수여야 합니다" }] });
    return n.data;
  };
  const partySize = num("partySize", 1)!;
  const durationMin = num("durationMin");
  const resourceIdRaw = u.searchParams.get("resourceId");
  const resourceId = resourceIdRaw ? uuidParam(resourceIdRaw) : undefined;

  const slotCtx = await loadSlotContext(id, dates[0], dates[dates.length - 1], { requirePublic: true });
  const hideResources = slotCtx.product.resourceSelectMode === "AUTO";

  const days = dates.map((date) => {
    const r = computeSlots(slotCtx, { date, partySize, durationMin, resourceId });
    // 입력 검증 실패는 날짜와 무관하다 — 첫 날짜에서 걸리면 전체가 400
    // 타 사업장·미연결 자원은 존재를 알리지 않는다 (콘솔 라우트와 같은 규칙)
    if (isSlotFailure(r)) throw r.error === "RESOURCE_NOT_LINKED" ? new HttpError(404, "NOT_FOUND") : new HttpError(400, r.error);
    const ok = r as SlotSuccess;
    const slots = hideResources ? ok.slots.map((s) => ({ start: s.start, end: s.end, remaining: s.remaining })) : ok.slots;
    return { date, slots, ...(ok.excluded ? { excluded: ok.excluded } : {}) };
  });

  return NextResponse.json({ productId: id, days }, { headers: { "Cache-Control": "no-store" } });
});
