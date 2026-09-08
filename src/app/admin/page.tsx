import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Alert, Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export const metadata = { title: "관리자 — 마주,봄" };

/** 관리자 자리표시자. ADMIN + TOTP(mfa=ok) 는 프록시가 강제했다. 가입 심사(#FR-ADM-010)는 관리자 에픽에서 */
export default async function AdminHome() {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin");
  return (
    <main style={{ minHeight: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/admin" aria-label="관리자 홈">
          <Logo size={24} />
        </Link>
        <span style={{ fontWeight: 600 }}>관리자</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Link href="/me/sessions">
            <Button size="sm">기기 관리</Button>
          </Link>
          <LogoutButton />
        </span>
      </header>
      <section style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <Alert kind="info">{s.user.name} 님, 2단계 인증을 통과했습니다. 가입 심사·사업장 상태 제어·신고 처리 화면은 관리자 에픽에서 붙습니다.</Alert>
      </section>
    </main>
  );
}
