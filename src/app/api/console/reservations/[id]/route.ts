import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { assertWritable, handle, requireConsole } from "@/features/auth/guards";
import { consoleActor, getReservation, reassignReservation } from "@/features/booking/console";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * GET /api/console/reservations/:id — 상세 + 상태 이력 (FR-BOOK-080, #61).
 * PATCH — 담당자·공간 변경. 상태 전이는 `/status` 가 따로 맡는다(표가 한 곳이어야 한다).
 *
 * 다른 사업장 · 매니저 범위 밖은 403 이 아니라 404 (#63) — 403 은 "그 id 는 있다" 를 알려 준다.
 */
export const GET = handle(async (_req, ctx) => {
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  return NextResponse.json(await getReservation(consoleActor(v), id, settings.timezone), { headers: { "Cache-Control": "no-store" } });
});

const patchSchema = z.object({ resourceId: z.uuid() });

export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  const body = await readJson(req, patchSchema);
  await reassignReservation(consoleActor(v), id, body.resourceId, requestMeta(req.headers));
  return NextResponse.json({ ok: true });
});
