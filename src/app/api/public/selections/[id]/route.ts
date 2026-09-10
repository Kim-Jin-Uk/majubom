import { NextResponse } from "next/server";
import { handle, HttpError } from "@/features/auth/guards";
import { loadSelection } from "@/features/booking/widget/selection";
import { uuidParam } from "@/lib/api";

/**
 * GET /api/public/selections/:id — 로그인 뒤 돌아왔을 때 선택을 되살린다 (#83).
 *
 * 만료·가게가 닫힘·상품이 내려감은 전부 **404 하나**다. 되살려 봐야 그다음 단계에서 막히고,
 * 손님은 왜 막히는지 모른 채 서 있게 된다 — 위젯은 404 를 받으면 "다시 골라 주세요" 로 되돌린다.
 */
export const GET = handle(async (_req, ctx) => {
  const id = uuidParam((await ctx.params).id);
  const sel = await loadSelection(id);
  if (!sel) throw new HttpError(404, "NOT_FOUND");
  return NextResponse.json({ selection: sel }, { headers: { "Cache-Control": "no-store" } });
});
