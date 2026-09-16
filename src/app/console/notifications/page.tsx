import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listInbox } from "@/features/notification/inbox";
import { NotificationList } from "@/features/notification/ui/NotificationList";

export const metadata = { title: "알림 — 마주,봄 콘솔" };

/**
 * 매장의 알림함 (FR-NOTI-030, #98). 손님 것과 **같은 목록**이다 — 알림은 사람에게 오는 것이지
 * 역할에 오는 것이 아니다. 겸업 계정(사장님이면서 손님)이 두 곳을 오가며 같은 줄을 두 번 읽지 않게.
 */
export default async function ConsoleNotificationsPage() {
  const v = await consoleViewer("/console/notifications");
  const { items, hasMore } = await listInbox(v.uid);
  return (
    <ConsoleShell userId={v.uid} current="notifications" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>알림</h1>
      <NotificationList initial={items.map((x) => ({ ...x, at: x.at.toISOString() }))} hasMore={hasMore} />
    </ConsoleShell>
  );
}
