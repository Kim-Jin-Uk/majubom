import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

/**
 * 서비스 헤더. 로그인 진입이 **여기** 있다 — 메인은 검색이고, 로그인은 둘러본 뒤에 하는 일이다.
 *
 * 서버 컴포넌트라 세션을 직접 읽는다. 콘솔 헤더(`ConsoleShell`)와는 다른 물건이다:
 * 저쪽은 사업자의 작업 공간이고 이쪽은 손님이 보는 서비스 머리다.
 */
export async function AppHeader() {
  const s = await auth();
  const signedIn = Boolean(s?.user.id);
  const membership = s?.principal?.membership ?? null;
  return (
    <header className="app-header">
      <Link href="/" className="app-header__home" aria-label="마주,봄 홈">
        <Logo size={22} />
      </Link>
      <nav className="app-header__nav">
        {signedIn ? (
          <>
            <Link href="/me/reservations">
              <Button size="sm">내 예약</Button>
            </Link>
            {membership && (
              <Link href="/console">
                <Button size="sm" variant="primary">
                  콘솔
                </Button>
              </Link>
            )}
            <LogoutButton />
          </>
        ) : (
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
        <ThemeToggle />
      </nav>
    </header>
  );
}
