import { notFound } from "next/navigation";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listHolidays } from "@/features/schedule/holidays";
import { HolidaysPanel } from "@/features/schedule/ui/HolidaysPanel";
import { todayIn } from "@/lib/dates";

export const metadata = { title: "휴무일 — 마주,봄 콘솔" };

/** 휴무일 관리 (FR-SCH-010, #38). OWNER 전용 */
export default async function HolidaysPage() {
  const v = await consoleViewer("/console/holidays");
  if (!v.isOwner) notFound();
  const [{ settings }, items, resources] = await Promise.all([loadConsoleBusiness(v.membership.businessId), listHolidays(v.membership.businessId), listResources(v.membership.businessId)]);
  return (
    <ConsoleShell current="schedule" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>휴무일</h1>
      <p className="sub" style={{ margin: 0 }}>휴무일은 근무표보다 항상 우선해요 — 근무로 편성돼 있어도 휴무면 예약이 막힙니다. 사업장 전체 또는 특정 담당자·공간에만 둘 수 있어요.</p>
      <HolidaysPanel initial={items} resources={resources} today={todayIn(settings.timezone)} readOnly={v.readOnly} timezone={settings.timezone} />
    </ConsoleShell>
  );
}
