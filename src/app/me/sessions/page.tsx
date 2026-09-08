import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { listSessions } from "@/features/auth/session-store";
import { SessionsPanel } from "@/features/auth/ui/SessionsPanel";

export const metadata = { title: "기기 관리 — 마주,봄" };

export default async function SessionsPage() {
  const s = await auth();
  if (!s?.user.id) redirect("/login?next=%2Fme%2Fsessions");
  const items = (await listSessions(s.user.id, s.sid ?? undefined)).map((x) => ({
    ...x,
    createdAt: x.createdAt.toISOString(),
    lastUsedAt: x.lastUsedAt.toISOString(),
    expiresAt: x.expiresAt.toISOString(),
  }));
  return (
    <main style={{ minHeight: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/" aria-label="홈">
          <Logo size={24} />
        </Link>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontWeight: 600 }}>기기 관리</span>
        <span className="actions actions--end">
          <Link href={s.principal?.membership ? "/console" : "/"}>
            <Button size="sm">{s.principal?.membership ? "콘솔" : "홈"}</Button>
          </Link>
        </span>
      </header>
      <section style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <SessionsPanel initial={items} />
      </section>
    </main>
  );
}
