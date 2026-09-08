import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { listMembers } from "@/features/auth/members";
import { MembersPanel } from "@/features/auth/ui/MembersPanel";

export const metadata = { title: "구성원 — 마주,봄 콘솔" };

/** 매니저 초대·목록 (FR-AUTH-020). 명세 화면은 /console/resources → 매니저 추가 — 자원 콘솔(#28)이 생기면 그쪽에 합친다 */
export default async function MembersPage() {
  const s = await auth();
  const m = s?.principal?.membership;
  if (!s?.user.id || !m) redirect("/login?next=%2Fconsole%2Fmembers");
  const members = await listMembers(m.businessId);
  return (
    <main style={{ minHeight: "100dvh" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <Link href="/console" aria-label="콘솔 홈">
          <Logo size={24} />
        </Link>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontWeight: 600 }}>구성원</span>
        <span className="actions actions--end">
          <Link href="/console">
            <Button size="sm">콘솔 홈</Button>
          </Link>
        </span>
      </header>
      <section style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
        <MembersPanel initial={members} isOwner={m.role === "OWNER"} />
      </section>
    </main>
  );
}
