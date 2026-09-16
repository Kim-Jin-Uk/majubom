import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { auth } from "@/features/auth/auth";
import { loadMyReservationDetail } from "@/features/booking/my-reservations";
import { dayLabel, dayOf } from "@/features/booking/ui/status";
import { myReviewOf, reviewStateFor } from "@/features/review/reviews";
import { reviewEditState } from "@/features/review/rules";
import { ReviewForm } from "@/features/review/ui/ReviewForm";

export const metadata = { title: "리뷰 쓰기 — 마주,봄" };

/**
 * 리뷰 작성·수정 (FR-REV-010, #92). 예약 상세에서만 들어온다 — 리뷰는 **예약 한 건에 붙는 글**이라
 * 어느 방문에 대한 글인지가 화면에 없으면 손님이 무엇을 쓰는지 모른다.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = `/me/reservations/${id}`;
  const s = await auth();
  if (!s?.user.id) redirect(`/login?next=${encodeURIComponent(`${back}/review`)}`);

  const [r, state] = await Promise.all([loadMyReservationDetail(s.user.id, id), reviewStateFor(s.user.id, id)]);
  // 남의 예약이면 둘 다 없다 — 있는지조차 알리지 않는다
  if (!r || !state) notFound();

  const existing = state.reviewId ? await myReviewOf(s.user.id, state.reviewId) : null;
  // 쓸 수도 고칠 수도 없으면 이 페이지에 머물 이유가 없다. 상세가 왜인지 말해 준다
  const editable = existing ? reviewEditState(existing, new Date()).can : state.eligibility.can;
  if (!editable) redirect(back);

  return (
    <>
      <AppHeader />
      <main className="search-main">
        <p className="sub" style={{ margin: 0 }}>
          <Link href={back}>← 예약 상세</Link>
        </p>
        <h1 className="search-title">{existing ? "리뷰 고치기" : "리뷰 쓰기"}</h1>
        <p className="sub" style={{ marginTop: -8 }}>
          {r.businessName} · {r.productName} · {dayLabel(dayOf(r.startAt))} 방문
        </p>
        <ReviewForm reservationId={id} review={existing} backHref={back} />
      </main>
    </>
  );
}
