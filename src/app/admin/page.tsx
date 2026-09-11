import { redirect } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { pendingCount } from "@/features/admin/businesses";
import { AdminShell } from "@/features/admin/ui/AdminShell";

export const metadata = { title: "관리자 — 마주,봄" };

/** 관리자 홈. ADMIN + TOTP(mfa=ok) 는 프록시가 강제했다 — 여기 redirect 는 직접 접근한 경우의 이중 방어다 */
export default async function AdminHome() {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin");
  const pending = await pendingCount();
  return (
    <AdminShell current="home" viewerName={s.user.name ?? ""} pending={pending}>
      <h1>관리자</h1>
      {pending > 0 ? (
        <Alert kind="warn">
          심사를 기다리는 신청이 {pending}건 있어요. <Link href="/admin/applications">가입 심사로 가기</Link>
        </Alert>
      ) : (
        <Alert kind="info">심사를 기다리는 신청이 없어요.</Alert>
      )}
      <ul style={{ marginTop: 16 }}>
        <li>
          <Link href="/admin/applications">가입 심사</Link> — 대기 중인 신청 승인·반려
        </li>
        <li>
          <Link href="/admin/businesses">사업장</Link> — 일시정지 · 차단 · 복구
        </li>
      </ul>
      <p className="sub" style={{ marginTop: 16 }}>사용량 · 감사 로그 조회 · 지표 대시보드 · 신고 처리는 아직 없습니다 (#67~#70).</p>
    </AdminShell>
  );
}
