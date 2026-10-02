import Link from "next/link";
import { unreadCount } from "@/features/notification/inbox";

/**
 * 헤더의 벨 + 미읽음 배지 (FR-NOTI-030, #98). **서버 컴포넌트다** — 세는 것은 한 줄짜리 집계라
 * 클라이언트로 내려 폴링할 이유가 없다. 화면을 옮길 때마다 새로 그려지므로 그때 최신이 된다.
 *
 * 99를 넘으면 `99+` 로 멈춘다. 세 자리가 되면 배지가 벨보다 커진다.
 */
export async function NotificationBell({ userId, href }: { userId: string; href: string }) {
  const n = await unreadCount(userId);
  return (
    <Link href={href} className="bell" aria-label={n > 0 ? `알림 ${n}개 안 읽음` : "알림"}>
      <span aria-hidden="true">🔔</span>
      {n > 0 && <span className="bell__dot">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
