import Link from "next/link";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listSwaps } from "@/features/schedule/swaps";
import { SwapsPanel } from "@/features/schedule/ui/SwapsPanel";
import { todayIn } from "@/lib/dates";

export const metadata = { title: "근무 교대 — 마주,봄 콘솔" };

/**
 * 근무 교대 (FR-SHIFT-010~030, #43). 근무표의 하위 화면 — 교대는 근무표를 바꾸는 일이라 메뉴를 따로 두지 않는다.
 * 매니저는 본인이 당사자인 것만, 사장님은 전부 본다 (`listSwaps`).
 */
export default async function SwapsPage() {
  const v = await consoleViewer("/console/schedule/swaps");
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  const actor = { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId };
  const [swaps, resources] = await Promise.all([listSwaps(v.membership.businessId, actor), listResources(v.membership.businessId)]);
  const mine = resources.find((r) => r.type === "STAFF" && r.memberId === v.membership.memberId) ?? null;
  // 계정이 살아 있는 담당자만 — 수락할 사람이 있어야 교대다
  const staff = resources.filter((r) => r.type === "STAFF" && r.isActive && r.memberId && r.member?.status === "ACTIVE" && r.id !== mine?.id).map((r) => ({ id: r.id, name: r.name }));

  return (
    <ConsoleShell current="schedule" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>근무 교대</h1>
      <p className="sub" style={{ margin: "0 0 16px" }}>
        동료와 근무를 바꿔요. <b>그날 예약을 어떻게 할지</b> 함께 정해야 요청할 수 있어요 — 근무만 넘기고 예약을 두면 그날 손님이 빈 가게에 옵니다.
        요청은 72시간 안에 응답이 없으면 자동으로 만료돼요. <Link href="/console/schedule">근무표로 돌아가기</Link>
      </p>
      <SwapsPanel initial={swaps} staff={staff} myResourceId={mine?.id ?? null} today={todayIn(settings.timezone)} readOnly={v.readOnly} />
    </ConsoleShell>
  );
}
