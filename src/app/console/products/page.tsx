import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listProducts } from "@/features/product/products";
import { ProductsPanel } from "@/features/product/ui/ProductsPanel";

export const metadata = { title: "상품 — 마주,봄 콘솔" };

/** 상품 목록 (에픽 #31). 매니저는 editProduct 권한이 있으면 담당 상품의 설명·사진·상태를 고칠 수 있다 */
export default async function ProductsPage() {
  const v = await consoleViewer("/console/products");
  const products = await listProducts(v.membership.businessId);
  const canEdit = v.isOwner || Boolean(v.membership.permissions.editProduct);
  return (
    <ConsoleShell current="products" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>상품</h1>
      <section className="panel">
        <p className="sub">고객이 예약 페이지에서 고르는 메뉴입니다. 자원(담당자·공간)이 무엇을 점유하는지라면, 상품은 언제·얼마나·몇 명이 예약하는지를 정해요.</p>
        <ProductsPanel initial={products} isOwner={v.isOwner} readOnly={v.readOnly} canEdit={canEdit && !v.readOnly} />
      </section>
    </ConsoleShell>
  );
}
