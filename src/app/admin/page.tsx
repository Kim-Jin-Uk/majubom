import { redirect } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { pendingCount } from "@/features/admin/businesses";
import { loadAdminMetrics } from "@/features/admin/metrics";
import { AdminShell } from "@/features/admin/ui/AdminShell";
import { MetricsBoard } from "@/features/admin/ui/MetricsBoard";

export const metadata = { title: "관리자 — 마주,봄" };

/**
 * 관리자 홈 = 서비스 지표 대시보드 (FR-ADM-050, #69).
 *
 * 별 경로를 만들지 않고 홈을 지표로 삼았다 — 운영자가 `/admin` 을 열었을 때 가장 먼저 알아야 할 것이
 * "지금 서비스가 어떤 상태인가" 이고, 링크 목록만 있는 홈은 한 번 더 누르게 할 뿐이다.
 * 심사 대기는 그 위에 남긴다. 지표보다 급한 유일한 것이라서다.
 *
 * ADMIN + TOTP(mfa=ok) 는 프록시가 강제했다 — 여기 redirect 는 직접 접근한 경우의 이중 방어다.
 */
export default async function AdminHome() {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin");
  const [pending, metrics] = await Promise.all([pendingCount(), loadAdminMetrics()]);
  return (
    <AdminShell current="home" viewerName={s.user.name ?? ""} pending={pending}>
      <h1>서비스 지표</h1>
      {pending > 0 && (
        <Alert kind="warn">
          심사를 기다리는 신청이 {pending}건 있어요. <Link href="/admin/applications">가입 심사로 가기</Link>
        </Alert>
      )}
      <MetricsBoard m={metrics} />
    </AdminShell>
  );
}
