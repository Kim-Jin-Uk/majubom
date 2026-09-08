import { z } from "zod";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { getScheduleGrid } from "@/features/schedule/calendar";
import { addDays, dowOf } from "@/features/schedule/resolve";
import { ScheduleGrid } from "@/features/schedule/ui/ScheduleGrid";
import { todayIn } from "@/lib/dates";

export const metadata = { title: "근무표 — 마주,봄 콘솔" };

/** 근무표 (FR-SCH-030, #41). 주간 그리드 — ?week=YYYY-MM-DD (그 주의 일요일). 매니저는 본인 행이 먼저, 동료 사유는 안 보인다 */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await consoleViewer("/console/schedule");
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  const today = todayIn(settings.timezone);
  const sp = await searchParams;
  const asked = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(sp.week);
  const anchor = asked.success ? asked.data : today;
  const weekStart = addDays(anchor, -dowOf(anchor));
  const grid = await getScheduleGrid(v.membership.businessId, weekStart, addDays(weekStart, 6), { uid: v.uid, role: v.membership.role, memberId: v.membership.memberId });
  return (
    <ConsoleShell current="schedule" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>근무표</h1>
      <p className="sub" style={{ margin: 0 }}>
        {v.isOwner ? "담당자별 근무 시간이에요. 칸을 누르면 그날만 바꾸는 예외(휴무·시간 변경·차단·추가 근무)를 둘 수 있어요. 반복되는 근무는 주간 패턴에서." : "내 근무와 동료의 근무 여부를 볼 수 있어요. 내 칸을 누르면 개인 차단 시간을 등록할 수 있습니다."}
      </p>
      <ScheduleGrid grid={grid} role={v.membership.role} weekStart={weekStart} today={today} />
    </ConsoleShell>
  );
}
