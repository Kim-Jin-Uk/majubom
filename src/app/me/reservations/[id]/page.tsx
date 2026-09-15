import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { loadMyReservationDetail } from "@/features/booking/my-reservations";
import { customerCancelState } from "@/features/booking/transition-rules";
import { ReservationActions } from "@/features/booking/ui/ReservationActions";
import { dayLabel, dayOf, rangeLabel, stampLabel, STATUS_COLOR, STATUS_LABEL } from "@/features/booking/ui/status";
import { myReviewOf, reviewStateFor } from "@/features/review/reviews";
import { reviewEditState } from "@/features/review/rules";
import { bookingHref, publicHomeHref, reviewsHref } from "@/features/site/routing";

export const metadata = { title: "예약 상세 — 마주,봄" };

/** 리뷰를 못 쓰는 이유별 문장. "안 됩니다" 하나로는 손님이 뭘 해야 할지 모른다 */
const REVIEW_BLOCKED: Record<string, string> = {
  NOT_COMPLETED: "방문을 마치면 리뷰를 남기실 수 있어요.",
  WALK_IN: "매장에서 대신 잡아 드린 예약은 리뷰를 쓸 수 없어요.",
  WINDOW_PASSED: "리뷰는 방문 후 30일 안에만 쓸 수 있어요.",
  ALREADY_WRITTEN: "이 방문에는 이미 리뷰를 남기셨어요.",
};

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

  // 리뷰 자격은 순수 규칙이 판정한다(`reviewEligibility`) — 화면이 다시 세면 서버와 갈라진다
  const review = await reviewStateFor(s.user.id, id);
  const written = review?.reviewId ? await myReviewOf(s.user.id, review.reviewId) : null;
  const canEdit = written ? reviewEditState(written, new Date()).can : false;

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

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>리뷰</h2>
          {written ? (
            <p className="sub">
              이 방문에 리뷰를 남기셨어요. <Link href={reviewsHref(r.slug)}>가게 리뷰 보기</Link>
              {canEdit && (
                <>
                  {" · "}
                  <Link href={`/me/reservations/${r.id}/review`}>고치기</Link> <span className="muted">(한 번만)</span>
                </>
              )}
            </p>
          ) : review?.eligibility.can ? (
            <p className="sub">
              다녀오신 곳은 어떠셨나요? <Link href={`/me/reservations/${r.id}/review`}>리뷰 남기기</Link>
              {" — "}
              {new Date(review.eligibility.deadline).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" })}까지 쓰실 수 있어요.
            </p>
          ) : (
            <p className="sub">{REVIEW_BLOCKED[(review && !review.eligibility.can && review.eligibility.reason) || "NOT_COMPLETED"]}</p>
          )}
        </section>

        {/* 없는 것을 조용히 빼지 않는다 — 명세에 있는 액션이라 왜 아직 없는지 말한다 */}
        <p className="sub" style={{ marginTop: 20 }}>
          문의하기(매장 상담방)는 아직 없어요. 채팅(에픽 17)이 들어오면 여기에 붙습니다 — 그때까지는 매장 전화가 가장 빠릅니다.
        </p>
      </main>
    </>
  );
}
