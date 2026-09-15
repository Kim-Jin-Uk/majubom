"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { apiDelete, describeError } from "@/lib/client-api";

/**
 * 내가 쓴 리뷰에 할 수 있는 일 (FR-REV-010, #92) — **고치기(7일 1회)와 삭제**.
 *
 * 삭제에 한 번 더 묻는 이유는 되돌릴 수 없어서다: 지운 예약에는 **다시 쓸 수 없다**
 * ("지우고 다시 쓰기" 로 평점을 갈아 치우는 길을 막아 뒀다). 그 사실을 누르기 전에 말한다.
 */
export function MyReviewActions({ reservationId, reviewId, canEdit, reviewsHref }: { reservationId: string; reviewId: string; canEdit: boolean; reviewsHref: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    const r = await apiDelete(`/api/me/reviews/${reviewId}`);
    setBusy(false);
    if (!r.ok) {
      setErr(describeError(r));
      setAsking(false);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}
      <p className="sub">
        이 방문에 리뷰를 남기셨어요. <Link href={reviewsHref}>가게 리뷰 보기</Link>
        {canEdit && (
          <>
            {" · "}
            <Link href={`/me/reservations/${reservationId}/review`}>고치기</Link> <span className="muted">(한 번만)</span>
          </>
        )}
      </p>
      {asking ? (
        <div className="actions" style={{ flexWrap: "wrap" }}>
          <span className="sub">지우면 이 방문에는 리뷰를 다시 쓰실 수 없어요.</span>
          <Button type="button" variant="danger" loading={busy} onClick={() => void remove()}>
            리뷰 삭제
          </Button>
          <Button type="button" onClick={() => setAsking(false)} disabled={busy}>
            그대로 두기
          </Button>
        </div>
      ) : (
        <div className="actions">
          <Button type="button" size="sm" onClick={() => setAsking(true)}>
            리뷰 삭제
          </Button>
        </div>
      )}
    </>
  );
}
