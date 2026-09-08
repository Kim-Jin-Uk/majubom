import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { getProduct, removeProduct, updateProduct, updateProductLimited } from "@/features/product/products";
import { productInputSchema, productLimitedInputSchema } from "@/features/product/schema";
import { readJson, uuidParam } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/**
 * GET /api/console/products/:id — 상세 (소속 멤버)
 * PUT — OWNER 는 전체 수정, MANAGER 는 editProduct 권한 + 본인 담당 상품에 한해 설명·사진·상태만 (FR-PRD-020)
 * DELETE — OWNER. 예약 이력이 있으면 ARCHIVED 로 대체 (FR-PRD-030)
 */
export const GET = handle(async (_req, ctx) => {
  const v = await requireConsole();
  const id = uuidParam((await ctx.params).id);
  return NextResponse.json({ product: await getProduct(v.membership.businessId, id) });
});

export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireConsole({ permission: "editProduct" });
  const id = uuidParam((await ctx.params).id);
  if (v.membership.role === "OWNER") {
    const body = await readJson(req, productInputSchema);
    return NextResponse.json(await updateProduct(v.membership.businessId, id, body));
  }
  const body = await readJson(req, productLimitedInputSchema);
  await updateProductLimited(v.membership.businessId, id, body, v.membership.memberId);
  return NextResponse.json({ ok: true, warnings: [], affected: 0 });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const id = uuidParam((await ctx.params).id);
  return NextResponse.json(await removeProduct(v.membership.businessId, id, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers)));
});
