"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { apiPost, apiPut, describeError } from "@/lib/client-api";
import { StarInput } from "./StarRating";

/** 서버가 내는 코드 → 손님 문구. 모르는 코드는 공통 문구로 떨어진다 */
const ERROR_TEXT: Record<string, string> = {
  NOT_COMPLETED: "방문을 마친 예약에만 리뷰를 쓸 수 있어요.",
  WALK_IN: "매장에서 대신 잡아 드린 예약은 리뷰를 쓸 수 없어요.",
  WINDOW_PASSED: "리뷰는 방문 후 30일 안에만 쓸 수 있어요.",
  ALREADY_WRITTEN: "이 예약에는 이미 리뷰를 쓰셨어요.",
  EDITED: "리뷰는 한 번만 고칠 수 있어요.",
  NOT_PUBLISHED: "지금은 고칠 수 없는 리뷰예요.",
};

/**
 * 리뷰 작성·수정 (FR-REV-010, #92).
 *
 * 사진은 아직 받지 않는다 — 손님이 올리는 사진은 사업장 한도가 아니라 **사용자당 일 30장·100MB**(FR-CHAT-020)로
 * 세야 하는데 그 표가 아직 없다. 열어 두면 로그인만으로 우리 저장소에 무한히 쓸 수 있다.
 */
export function ReviewForm({
  reservationId,
  review,
  backHref,
}: {
  reservationId: string;
  /** 있으면 수정 */
  review: { id: string; rating: number; content: string } | null;
  backHref: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [content, setContent] = useState(review?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tooShort = content.trim().length < 10;

  async function submit() {
    setBusy(true);
    setErr(null);
    const body = { rating, content: content.trim(), images: [] };
    const r = review ? await apiPut(`/api/me/reviews/${review.id}`, body) : await apiPost("/api/me/reviews", { reservationId, ...body });
    setBusy(false);
    if (!r.ok) {
      setErr(ERROR_TEXT[r.error] ?? describeError(r));
      return;
    }
    router.push(backHref);
    router.refresh();
  }

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}
      {review && <Alert kind="info">리뷰는 <b>한 번만</b> 고칠 수 있어요. 저장하면 더는 바꾸지 못합니다.</Alert>}

      <div className="review-field">
        <span className="review-label">별점</span>
        <StarInput value={rating} onChange={setRating} />
      </div>

      <label className="review-field" htmlFor="review-content">
        <span className="review-label">어떠셨나요?</span>
        <textarea
          id="review-content"
          className="textarea"
          rows={6}
          maxLength={500}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="다음 손님에게 도움이 될 이야기를 남겨 주세요. 10자 이상."
        />
        <span className="sub">{content.trim().length}/500</span>
      </label>

      {/* 작성자 이름은 공개 화면에서 마스킹된다 — 쓰기 전에 알려 준다 */}
      <p className="sub">가게 페이지에는 <b>홍*동</b> 처럼 이름이 가려져 보여요.</p>

      <div className="actions">
        <Button type="button" variant="primary" loading={busy} disabled={rating === 0 || tooShort} onClick={() => void submit()}>
          {review ? "수정 저장" : "리뷰 남기기"}
        </Button>
        <a className="btn" href={backHref}>
          취소
        </a>
      </div>
    </>
  );
}
