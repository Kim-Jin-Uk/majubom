import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { listInbox } from "@/features/notification/inbox";
import { NotificationList } from "@/features/notification/ui/NotificationList";

export const metadata = { title: "알림 — 마주,봄" };

/** 손님의 알림함 (FR-NOTI-030, #98) */
export default async function MyNotificationsPage() {
  const s = await auth();
  if (!s?.user.id) redirect("/login?next=%2Fme%2Fnotifications");
  const { items, hasMore } = await listInbox(s.user.id);
  return (
    <>
      <AppHeader />
      <main className="search-main">
        <h1 className="search-title">알림</h1>
        <NotificationList initial={items.map((x) => ({ ...x, at: x.at.toISOString() }))} hasMore={hasMore} />
      </main>
    </>
  );
}
