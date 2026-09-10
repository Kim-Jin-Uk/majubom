import { redirect } from "next/navigation";
import { auth } from "@/features/auth/auth";
import { listBusinesses, listQuerySchema, pendingCount } from "@/features/admin/businesses";
import { AdminShell } from "@/features/admin/ui/AdminShell";
import { BusinessesPanel } from "@/features/admin/ui/BusinessesPanel";

export const metadata = { title: "사업장 — 마주,봄 관리자" };

/** 사업장 상태 제어 (FR-ADM-020, #66) */
export default async function AdminBusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin%2Fbusinesses");
  const sp = await searchParams;
  const parsed = listQuerySchema.safeParse({ status: sp.status, q: sp.q });
  const [businesses, pending] = await Promise.all([listBusinesses(parsed.success ? parsed.data : {}), pendingCount()]);

  return (
    <AdminShell current="businesses" viewerName={s.user.name ?? ""} pending={pending}>
      <h1>사업장</h1>
      <p className="sub" style={{ margin: "0 0 16px" }}>
        <b>일시정지</b>는 새 예약만 막고 확정된 예약과 손님 상담은 그대로 둡니다. <b>차단</b>은 콘솔 접근까지 막아요 —
        앞으로 잡힌 예약이 남아 있으면 함께 취소할지 물어봅니다. 두 경우 모두 사유가 사업자에게 그대로 전달돼요.
      </p>
      <BusinessesPanel initial={businesses} />
    </AdminShell>
  );
}
