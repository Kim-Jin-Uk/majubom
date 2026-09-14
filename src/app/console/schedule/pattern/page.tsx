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
      {/* 9/14 이전에는 "영업시간을 먼저 정하라" 고 했다. 지금은 정반대다 — 미정이면 하루 전체가 열리고 자동 확정만 꺼진다.
          옛 문구를 두면 근무표만 짜 둔 매장이 "정하지 않으면 예약이 안 열린다" 고 믿고 불필요하게 영업시간부터 채운다 (리뷰 지적) */}
      {settings.openingHours.length === 0 && (
        <Alert kind="info">
          영업시간을 아직 정하지 않았어요. 그동안은 <b>여기 정한 근무시간</b>이 그대로 예약 가능 시간이 됩니다.
          영업시간을 정하면 그때부터 <b>영업시간 ∩ 근무시간</b>으로 좁혀져요.
        </Alert>
      )}
      <PatternEditor staff={staff} selected={selected} view={view} today={today} readOnly={v.readOnly} />
    </ConsoleShell>
  );
}
