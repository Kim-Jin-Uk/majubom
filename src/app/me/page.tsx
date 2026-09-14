import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { listSessions } from "@/features/auth/session-store";
import { SessionsPanel } from "@/features/auth/ui/SessionsPanel";
import { visibleGroups } from "@/features/me/notification-rules";
import { loadPreferences, loadProfile } from "@/features/me/profile";
import { NotificationPrefs } from "@/features/me/ui/NotificationPrefs";
import { ProfileForm } from "@/features/me/ui/ProfileForm";

export const metadata = { title: "내 정보 — 마주,봄" };

/**
 * 마이페이지 (FR-NOTI-030, #90). 프로필 · 알림 채널 · 설치된 기기를 **한 장에** 둔다 —
 * 명세가 기기 관리를 "`FR-NOTI-030` 의 설치된 기기 화면에 통합" 이라고 못 박은 자리다.
 * `/me/sessions` 는 그대로 둔다(기존 링크·메일이 가리키고 있다).
 */
export default async function MePage() {
  const s = await auth();
  if (!s?.user.id) redirect("/login?next=%2Fme");
  const [profile, prefs, sessions] = await Promise.all([
    loadProfile(s.user.id),
    loadPreferences(s.user.id),
    listSessions(s.user.id, s.sid ?? undefined),
  ]);
  if (!profile) redirect("/login?next=%2Fme");

  return (
    <>
      <AppHeader />
      <main className="search-main">
        <h1 className="search-title">내 정보</h1>
        <p className="sub" style={{ marginTop: -8 }}>
          예약 내역은 <Link href="/me/reservations">내 예약</Link>에 있어요.
        </p>
        <ProfileForm initial={profile} />
        <NotificationPrefs initial={prefs} groups={visibleGroups(Boolean(s.principal?.membership))} />
        <section className="panel">
          <h2>설치된 기기</h2>
          <SessionsPanel
            initial={sessions.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), lastUsedAt: x.lastUsedAt.toISOString(), expiresAt: x.expiresAt.toISOString() }))}
          />
        </section>
      </main>
    </>
  );
}
