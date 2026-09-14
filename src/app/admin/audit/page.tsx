import { redirect } from "next/navigation";
import { auth } from "@/features/auth/auth";
import { listAuditLogs, usedActions } from "@/features/admin/audit";
import { pendingCount } from "@/features/admin/businesses";
import { AdminShell } from "@/features/admin/ui/AdminShell";
import { AuditPanel } from "@/features/admin/ui/AuditPanel";

export const metadata = { title: "감사 로그 — 마주,봄 관리자" };

/** 감사 로그 조회 (FR-ADM-040, #68) */
export default async function AdminAuditPage() {
  const s = await auth();
  if (!s?.user.id || s.principal?.globalRole !== "ADMIN" || s.mfa !== "ok") redirect("/login/totp?next=%2Fadmin%2Faudit");
  // 첫 화면은 필터 없는 최신 50건. 필터는 클라이언트가 API 로 다시 읽는다 — 조건을 URL 에 얹지 않는 이유는
  // 조사 중에 짚은 조건이 주소창에 남아 공유되면 그 자체가 개인정보 단서가 되기 때문이다
  const [page, actions, pending] = await Promise.all([listAuditLogs(), usedActions(), pendingCount()]);

  return (
    <AdminShell current="audit" viewerName={s.user.name ?? ""} pending={pending}>
      <h1>감사 로그</h1>
      <p className="sub" style={{ margin: "0 0 16px" }}>
        운영자·사업자의 상태 변경을 최신순으로 봅니다. 한 줄을 누르면 <b>무엇이 무엇으로</b> 바뀌었는지 펼쳐져요.
        연락처·이메일은 적재 시점에 이미 해시라 원문으로 되돌릴 수 없고, <b>해시 a1b2c3d4…</b> 로 보입니다.
      </p>
      <AuditPanel initial={{ ...page, actions }} />
    </AdminShell>
  );
}
