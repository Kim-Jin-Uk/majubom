import { notFound } from "next/navigation";
import { z } from "zod";
import { Alert } from "@/components/ui";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { PatternEditor } from "@/features/schedule/ui/PatternEditor";
import { getPatterns } from "@/features/schedule/work-schedules";
import { todayIn } from "@/lib/dates";

export const metadata = { title: "주간 근무 패턴 — 마주,봄 콘솔" };

/** 주간 패턴 편성 (FR-SCH-020, #39). OWNER 전용 */
export default async function PatternPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await consoleViewer("/console/schedule/pattern");
  if (!v.isOwner) notFound();
  const sp = await searchParams;
  const [{ settings }, resources] = await Promise.all([loadConsoleBusiness(v.membership.businessId), listResources(v.membership.businessId)]);
  const staff = resources.filter((r) => r.type === "STAFF");
  const asked = z.uuid().safeParse(sp.resource);
  const selected = asked.success && staff.some((s) => s.id === asked.data) ? asked.data : staff[0]?.id ?? null;
  const today = todayIn(settings.timezone);
  const view = selected ? await getPatterns(v.membership.businessId, selected, today) : null;
  return (
    <ConsoleShell current="schedule" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>주간 근무 패턴</h1>
      <p className="sub" style={{ margin: 0 }}>요일별 출퇴근·휴게를 정하면 매주 반복돼요. 특정 날만 다르면 근무표에서 그 칸을 눌러 예외를 두세요.</p>
      {settings.openingHours.length === 0 && <Alert kind="warn">영업시간이 아직 없어요. 근무는 저장되지만 예약은 영업시간 ∩ 근무시간에만 열려요 — 설정에서 영업시간을 먼저 정해 주세요.</Alert>}
      <PatternEditor staff={staff} selected={selected} view={view} today={today} readOnly={v.readOnly} />
    </ConsoleShell>
  );
}
