import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export default async function Home() {
  const s = await auth();
  const signedIn = Boolean(s?.user.id);
  const membership = s?.principal?.membership ?? null;
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 24,
        textAlign: "center",
      }}
    >
      <Logo size={40} />
      <p style={{ margin: 0, color: "var(--text-2)" }}>마주,봄 — 준비 중입니다</p>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        {!signedIn && (
          <>
            <Link href="/login">
              <Button size="sm">로그인</Button>
            </Link>
            <Link href="/signup/business">
              <Button size="sm" variant="primary">
                사업자 가입
              </Button>
            </Link>
          </>
        )}
        {signedIn && (
          <>
            <span style={{ alignSelf: "center", fontSize: 13, color: "var(--text-2)" }}>{s?.user.name} 님</span>
            {membership && (
              <Link href="/console">
                <Button size="sm" variant="primary">
                  콘솔
                </Button>
              </Link>
            )}
            <Link href="/me/sessions">
              <Button size="sm">기기 관리</Button>
            </Link>
            <LogoutButton />
          </>
        )}
      </div>
      <ThemeToggle />
    </main>
  );
}
