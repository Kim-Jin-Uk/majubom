import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { loadMyReservations } from "@/features/booking/my-reservations";
import { MyReservationList } from "@/features/booking/ui/MyReservationList";

export const metadata = { title: "내 예약 — 마주,봄" };

/**
 * 고객의 예약 내역 (FR-BOOK-090, #88).
 *
 * 취소·시간 변경·캘린더 담기는 **상세**(#89)에 있다. 목록에 다 늘어놓으면 카드마다 버튼이 넷이고,
 * 손님이 잘못 누르는 자리만 늘어난다. 목록에 남기는 것은 예약번호다 — 전화로 말할 값이 그것이다.
 */
export default async function MyReservationsPage() {
  const s = await auth();
  if (!s?.user.id) redirect(`/login?next=${encodeURIComponent("/me/reservations")}`);
  const { upcoming, past } = await loadMyReservations(s.user.id);

  return (
    <>
      <AppHeader />
      <main className="search-main">
        <h1 className="search-title">내 예약</h1>
        <MyReservationList upcoming={upcoming} past={past} />
      </main>
    </>
  );
}
