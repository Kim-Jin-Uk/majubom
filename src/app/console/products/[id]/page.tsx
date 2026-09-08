import { notFound } from "next/navigation";
import { z } from "zod";
import { Alert } from "@/components/ui";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { getProduct, isAssignedManager } from "@/features/product/products";
import { ProductForm } from "@/features/product/ui/ProductForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  void (await params);
  return { title: "상품 수정 — 마주,봄 콘솔" };
}

/** 상품 수정 (FR-PRD-020). OWNER 전체 · MANAGER(editProduct + 담당) 제한 편집 · 그 외 매니저는 읽기 전용 */
export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const v = await consoleViewer(`/console/products/${id}`);
  const sp = await searchParams;
  const [product, resources] = await Promise.all([getProduct(v.membership.businessId, id).catch(() => null), listResources(v.membership.businessId)]);
  if (!product) notFound();
  const limited = !v.isOwner && Boolean(v.membership.permissions.editProduct) && (await isAssignedManager(id, v.membership.memberId));
  const readOnly = v.readOnly || (!v.isOwner && !limited) || product.status === "ARCHIVED";
  return (
    <ConsoleShell current="products" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>{product.name}</h1>
      {sp.saved && <Alert kind="ok">등록했어요.{sp.warn ? " 영업시간 밖 회차가 있어 아래에 표시했어요 — 그 회차는 예약 페이지에 보이지 않습니다." : ""}</Alert>}
      {product.status === "ARCHIVED" && <Alert kind="warn">보관된 상품이에요. 예약 페이지에 보이지 않고 수정할 수 없습니다. 과거 예약·리뷰의 기록을 위해 남아 있어요.</Alert>}
      {!v.isOwner && !limited && product.status !== "ARCHIVED" && <Alert kind="info">본인이 담당 자원인 상품만 (설명·사진·노출) 수정할 수 있어요. 이 상품은 읽기만 가능합니다.</Alert>}
      <ProductForm businessId={v.membership.businessId} resources={resources} initial={product} mode="page" limited={limited} readOnly={readOnly} />
    </ConsoleShell>
  );
}
