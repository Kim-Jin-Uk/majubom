import { notFound } from "next/navigation";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { ProductForm } from "@/features/product/ui/ProductForm";

export const metadata = { title: "상품 등록 — 마주,봄 콘솔" };

/** 상품 등록 (FR-PRD-010). OWNER 전용 — 매니저는 404 */
export default async function NewProductPage() {
  const v = await consoleViewer("/console/products/new");
  if (!v.isOwner) notFound();
  const resources = await listResources(v.membership.businessId);
  return (
    <ConsoleShell current="products" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>상품 등록</h1>
      <ProductForm businessId={v.membership.businessId} resources={resources} initial={null} mode="page" limited={false} readOnly={v.readOnly} />
    </ConsoleShell>
  );
}
