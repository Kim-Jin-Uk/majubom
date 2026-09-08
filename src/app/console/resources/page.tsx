import { listMembers } from "@/features/auth/members";
import { MembersPanel } from "@/features/auth/ui/MembersPanel";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { ResourcesPanel } from "@/features/business/ui/ResourcesPanel";
import { consoleViewer } from "@/features/business/ui/console-viewer";

export const metadata = { title: "담당자 · 공간 — 마주,봄 콘솔" };

/** 자원 콘솔 (FR-RES-010, #28) + 구성원 관리 (FR-AUTH-020, #30). 명세 화면 "/console/resources → 매니저 추가" 대로 한 화면에 둔다 */
export default async function ResourcesPage() {
  const v = await consoleViewer("/console/resources");
  const [resources, members] = await Promise.all([listResources(v.membership.businessId), listMembers(v.membership.businessId)]);
  return (
    <ConsoleShell current="resources" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>담당자 · 공간</h1>
      <section className="panel">
        <h2>자원</h2>
        <p className="sub">예약이 점유하는 것들입니다. 비활성 자원은 새 예약을 받지 않고, 기존 예약은 그대로 유지됩니다.</p>
        <ResourcesPanel initial={resources} members={members} isOwner={v.isOwner} readOnly={v.readOnly} mode="page" />
      </section>
      <section className="panel">
        <h2>구성원</h2>
        <p className="sub">콘솔에 들어올 수 있는 계정입니다. 매니저를 초대하면 같은 이름의 담당자 자원에 자동으로 연결되고, 없으면 새로 만들어집니다.</p>
        <MembersPanel initial={members} isOwner={v.isOwner && !v.readOnly} />
      </section>
    </ConsoleShell>
  );
}
