import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export type ConsoleNavKey = "home" | "onboarding" | "resources" | "settings";

const NAV: Array<{ key: ConsoleNavKey; href: string; label: string; ownerOnly?: boolean }> = [
  { key: "home", href: "/console", label: "홈" },
  { key: "onboarding", href: "/console/onboarding", label: "매장 준비" },
  { key: "resources", href: "/console/resources", label: "담당자 · 공간" },
  { key: "settings", href: "/console/settings", label: "설정", ownerOnly: true },
];

/**
 * 콘솔 공통 헤더 + 본문 컨테이너. 접근 제어는 프록시가, 상태 배너는 app/console/layout.tsx 가 맡는다.
 * 매니저에게는 OWNER 전용 메뉴(설정)를 감춘다 — API 가 403 을 내지만 보이지 않는 게 낫다.
 */
export function ConsoleShell({
  current,
  viewer,
  children,
  wide = false,
}: {
  current: ConsoleNavKey;
  viewer: { name: string; role: "OWNER" | "MANAGER" };
  children: ReactNode;
  /** 위저드처럼 본문이 직접 폭을 관리할 때 */
  wide?: boolean;
}) {
  return (
    <div className="console">
      <header className="console-head">
        <Link href="/console" aria-label="콘솔 홈">
          <Logo size={24} />
        </Link>
        <nav className="console-nav" aria-label="콘솔 메뉴">
          {NAV.filter((n) => !n.ownerOnly || viewer.role === "OWNER").map((n) => (
            <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="actions actions--end">
          <span className="who" style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "nowrap" }}>
            {viewer.name} · {viewer.role === "OWNER" ? "사업자" : "매니저"}
          </span>
          <ThemeToggle size={32} />
          <Link href="/me/sessions" style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "nowrap" }}>
            기기 관리
          </Link>
          <LogoutButton />
        </div>
      </header>
      {wide ? children : <div className="console-body">{children}</div>}
    </div>
  );
}
