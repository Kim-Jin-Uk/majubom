import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export const metadata = { title: "콘솔 — 마주,봄" };

/**
 * 콘솔 자리표시자. 접근 제어(로그인·소속·상태·이메일 검증)는 프록시가 끝냈다 — 여기 오면 통과한 사용자다.
 * 실제 대시보드는 #59(8-1), 온보딩 위저드는 #25(3-1). 지금은 상태 배너와 다음 단계만 보여준다.
 */
export default async function ConsoleHome() {
  const s = await auth();
  const m = s?.principal?.membership;
  if (!s?.user.id || !m) redirect("/login?next=%2Fconsole");
  return (
    <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      {m.businessStatus === "PENDING" && <div className="banner">심사 중 — 승인되면 예약 페이지가 공개됩니다. 그동안 매장·자원·상품을 준비해 두세요.</div>}
      {m.businessStatus === "REJECTED" && <div className="banner">가입 신청이 반려되었습니다. 메일의 사유를 확인하고 다시 신청할 수 있어요.</div>}
      {m.businessStatus === "SUSPENDED" && <div className="banner">사업장이 일시정지되어 읽기 전용입니다. 예약 취소와 고객 상담은 계속 할 수 있어요.</div>}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/console" aria-label="콘솔 홈">
          <Logo size={24} />
        </Link>
        <div className="row" style={{ alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "nowrap" }}>
            {s.user.name} · {m.role === "OWNER" ? "사업자" : "매니저"}
          </span>
          <ThemeToggle size={32} />
          <LogoutButton />
        </div>
      </header>
      <section style={{ padding: 24, maxWidth: 720, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{m.businessSlug.startsWith("b-") ? "새 사업장" : m.businessSlug}</h1>
        <Alert kind="info">콘솔은 준비 중입니다. 온보딩 위저드(매장 정보 → 담당자 → 첫 상품 → 로고 → 정책 → 채팅)가 다음 순서로 붙습니다.</Alert>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {m.role === "OWNER" && (
            <Link href="/console/members">
              <Button size="sm">매니저 초대</Button>
            </Link>
          )}
          <Link href="/me/sessions">
            <Button size="sm">기기 관리</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
