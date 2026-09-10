import { redirect } from "next/navigation";
import { auth } from "@/features/auth/auth";
import { listApplications, listQuerySchema, pendingCount } from "@/features/admin/businesses";
import { AdminShell } from "@/features/admin/ui/AdminShell";
import { ApplicationsPanel } from "@/features/admin/ui/ApplicationsPanel";
import Link from "next/link";

export const metadata = { title: "가입 심사 — 마주,봄 관리자" };

const TABS = [
  { status: "PENDING", label: "대기" },
  { status: "APPROVED", label: "승인" },
  { status: "REJECTED", label: "반려" },
] as const;

/** 가입 심사 (FR-ADM-010, #65). 대기 큐는 오래된 순 — 기다린 사람이 먼저다 */
export default async function AdminApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin%2Fapplications");
  const sp = await searchParams;
  const parsed = listQuerySchema.safeParse({ status: sp.status, q: sp.q });
  const query = parsed.success ? parsed.data : {};
  const status = query.status ?? "PENDING";
  const [applications, pending] = await Promise.all([listApplications(query), pendingCount()]);

  return (
    <AdminShell current="applications" viewerName={s.user.name ?? ""} pending={pending}>
      <h1>가입 심사</h1>
      <p className="sub" style={{ margin: "0 0 12px" }}>
        이메일 검증을 마친 신청만 큐에 올라와요. 승인하면 그때 <b>예약 페이지가 공개</b>됩니다 — 콘솔은 신청 직후부터 열려 있어요.
      </p>
      <nav style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link key={t.status} href={`/admin/applications?status=${t.status}`} aria-current={t.status === status ? "page" : undefined} style={{ fontWeight: t.status === status ? 600 : 400 }}>
            {t.label}
            {t.status === "PENDING" && pending ? ` (${pending})` : ""}
          </Link>
        ))}
      </nav>
      <ApplicationsPanel initial={applications} status={status} />
    </AdminShell>
  );
}
