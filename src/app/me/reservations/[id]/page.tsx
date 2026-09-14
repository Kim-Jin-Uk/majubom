import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { loadMyReservationDetail } from "@/features/booking/my-reservations";
import { customerCancelState } from "@/features/booking/transition-rules";
import { ReservationActions } from "@/features/booking/ui/ReservationActions";
import { dayLabel, dayOf, rangeLabel, stampLabel, STATUS_COLOR, STATUS_LABEL } from "@/features/booking/ui/status";
import { bookingHref, publicHomeHref } from "@/features/site/routing";

export const metadata = { title: "예약 상세 — 마주,봄" };

/**
 * 예약 상세 (FR-BOOK-090, #89).
 *
 * **남의 예약 id 는 404 다.** 403 을 내면 "그 id 의 예약은 있다" 를 알려 주는 꼴이라,
 * 조회 계층이 아예 본인 것만 찾고 없으면 없는 페이지가 된다.
 */
export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await auth();
  if (!s?.user.id) redirect(`/login?next=${encodeURIComponent(`/me/reservations/${id}`)}`);
  const r = await loadMyReservationDetail(s.user.id, id);
  if (!r) notFound();

  const cancel = customerCancelState(
    { status: r.status, startAt: new Date(r.startInstant), endAt: new Date(r.endInstant), cancelDeadlineHours: r.cancelDeadlineHours },
    new Date(),
  );
  const [bg, fg] = STATUS_COLOR[r.status];

  return (
    <>
      <AppHeader />
      <main className="search-main">
        <p className="sub" style={{ margin: 0 }}>
          <Link href="/me/reservations">← 내 예약</Link>
        </p>
        <div className="myres__top" style={{ marginTop: 8 }}>
          <h1 className="search-title" style={{ margin: 0 }}>
            {r.productName}
          </h1>
          <span className="myres__badge" style={{ background: bg, color: fg }}>
            {STATUS_LABEL[r.status]}
          </span>
        </div>

        <dl className="resdt">
          <div>
            <dt>일시</dt>
            <dd>
              {dayLabel(dayOf(r.startAt))} {rangeLabel(r.startAt, r.endAt)}
            </dd>
          </div>
          <div>
            <dt>매장</dt>
            <dd>
              <Link href={publicHomeHref(r.slug)}>{r.businessName}</Link>
              {r.businessAddress && <div className="sub">{r.businessAddress}</div>}
              {/* 전화는 누르면 걸리게 둔다 — 취소 마감 뒤에 손님이 할 수 있는 유일한 일이다 */}
              {r.businessPhone && (
                <div>
                  <a href={`tel:${r.businessPhone}`}>{r.businessPhone}</a>
                </div>
              )}
            </dd>
          </div>
          <div>
            <dt>인원</dt>
            <dd>{r.partySize}명{r.staffName ? ` · 담당 ${r.staffName}` : ""}</dd>
          </div>
          <div>
            <dt>예약번호</dt>
            <dd>
              <b className="resdt__code">{r.code}</b>
            </dd>
          </div>
          {r.customerNote && (
            <div>
              <dt>요청사항</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{r.customerNote}</dd>
            </div>
          )}
        </dl>

        <ReservationActions
          id={r.id}
          cancel={{ can: cancel.can, blocked: cancel.blocked, deadlineLabel: cancel.deadline ? stampLabel(cancel.deadline.toISOString()) : null }}
          // 변경은 **새 예약 + `replaces`** 다(FR-BOOK-050). 취소가 막힌 건은 변경도 막는다 —
          // 서버가 원 예약을 취소해야 성립하는 흐름이라, 열어 두면 위젯 끝에서 실패한다
          changeHref={cancel.can ? bookingHref(r.slug, r.productId, r.id) : null}
        />

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>진행 이력</h2>
          <ol className="resdt__log">
            {r.history.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="sub">{stampLabel(e.at)}</span>
                <b>{STATUS_LABEL[e.status]}</b>
                {e.reason && <span className="sub">— {e.reason}</span>}
              </li>
            ))}
          </ol>
        </section>

        {/* 없는 것을 조용히 빼지 않는다 — 명세에 있는 액션이라 왜 아직 없는지 말한다 */}
        <p className="sub" style={{ marginTop: 20 }}>
          문의하기(매장 상담방)와 리뷰 쓰기는 아직 없어요. 채팅(에픽 17)·리뷰(에픽 13)가 들어오면 여기에 붙습니다.
          그때까지는 매장 전화가 가장 빠릅니다.
        </p>
      </main>
    </>
  );
}
