import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { loadMyReservations, type MyReservation } from "@/features/booking/my-reservations";
import { dayLabel, dayOf, rangeLabel, STATUS_COLOR, STATUS_LABEL } from "@/features/booking/ui/status";
import { publicHomeHref } from "@/features/site/routing";

export const metadata = { title: "내 예약 — 마주,봄" };

/**
 * 고객의 예약 내역 (조회만).
 *
 * 취소·시간 변경·문의하기는 예약 상세(#89)의 몫이라 여기서는 **보여 주기만** 한다.
 * 확정 메일도 같은 말을 한다 — "바꾸거나 취소하려면 매장으로 연락, 예약번호를 알려 주세요".
 * 그래서 카드에 예약번호를 크게 둔다. 손님이 전화로 말할 값이 그것이다.
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
        <Section title="다가오는 예약" rows={upcoming} empty="다가오는 예약이 없어요." />
        <Section title="지난 예약" rows={past} empty="지난 예약이 없어요." />
      </main>
    </>
  );
}

function Section({ title, rows, empty }: { title: string; rows: MyReservation[]; empty: string }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
        {title} <span className="muted">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="sub">{empty}</p>
      ) : (
        <ul className="myres-list">
          {rows.map((r) => (
            <li key={r.id} className="myres">
              <div className="myres__top">
                {/* 가게 이름을 누르면 매장 홈이다 — 전화번호·길찾기가 거기 있다 */}
                <Link href={publicHomeHref(r.slug)} className="myres__biz">
                  {r.businessName}
                </Link>
                <Badge status={r.status} />
              </div>
              <div className="myres__when">
                {dayLabel(dayOf(r.startAt))} {rangeLabel(r.startAt, r.endAt)}
              </div>
              <div className="myres__meta muted">
                {r.productName}
                {r.staffName ? ` · ${r.staffName}` : ""} · {r.partySize}명
              </div>
              <div className="myres__code">
                예약번호 <b>{r.code}</b>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Badge({ status }: { status: MyReservation["status"] }) {
  const [bg, fg] = STATUS_COLOR[status];
  return (
    <span className="myres__badge" style={{ background: bg, color: fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}
