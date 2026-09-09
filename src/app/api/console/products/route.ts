import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { createProduct, listProducts } from "@/features/product/products";
import { productInputSchema } from "@/features/product/schema";
import { readJson } from "@/lib/api";
import { revalidatePublicHome } from "@/features/site/revalidate";

/** GET /api/console/products — 상품 목록 (소속 멤버, ARCHIVED 제외) · POST — 등록 (OWNER, FR-PRD-010). 응답 warnings: 영업시간 밖 고정 회차 */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ products: await listProducts(v.membership.businessId) });
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, productInputSchema);
  const r = await createProduct(v.membership.businessId, body);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true, id: r.id, warnings: r.warnings }, { status: 201 });
});
