import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export type AdminNavKey = "home" | "applications" | "businesses";

const NAV: Array<{ key: AdminNavKey; href: string; label: string }> = [
  { key: "home", href: "/admin", label: "홈" },
  { key: "applications", href: "/admin/applications", label: "가입 심사" },
  { key: "businesses", href: "/admin/businesses", label: "사업장" },
];

/**
 * 관리자 공통 껍데기. 접근 제어(ADMIN + TOTP)는 프록시가 이미 했다 — 여기서 다시 판단하지 않는다.
 * 심사 대기 건수를 메뉴에 붙이는 이유: 관리자가 이 화면을 상시로 열어 두지 않기 때문이다.
 */
export function AdminShell({ current, viewerName, pending, children }: { current: AdminNavKey; viewerName: string; pending?: number; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <Link href="/admin" aria-label="관리자 홈">
          <Logo size={24} />
        </Link>
        <span style={{ fontWeight: 600 }}>관리자</span>
        <nav style={{ display: "flex", gap: 12 }}>
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined} style={{ fontWeight: n.key === current ? 600 : 400 }}>
              {n.label}
              {n.key === "applications" && pending ? ` (${pending})` : ""}
            </Link>
          ))}
        </nav>
        <span className="actions actions--end">
          <span className="sub" style={{ whiteSpace: "nowrap" }}>{viewerName}</span>
          <Link href="/me/sessions">
            <Button size="sm">기기 관리</Button>
          </Link>
          <LogoutButton />
        </span>
      </header>
      <section style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>{children}</section>
    </main>
  );
}
