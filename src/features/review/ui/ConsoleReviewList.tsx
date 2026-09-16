"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { PublicReview } from "@/features/review/reviews";
import { apiDelete, apiPut, describeError } from "@/lib/client-api";
import { Stars } from "./StarRating";

type Row = Omit<PublicReview, "at" | "reply"> & { at: string; reply: { content: string; at: string } | null };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });

/**
 * 콘솔의 리뷰 — **답글만 단다** (FR-REV-020, #93).
 *
 * 숨김·삭제 버튼은 만들지 않는다. 사업자가 임의로 지울 수 있으면 리뷰 신뢰도가 0 이 된다 —
 * 부적절한 글은 가게 페이지의 [신고] 로 관리자에게 간다. 그 판단은 매장의 것이 아니다.
 * 작성자 이름은 여기서도 마스킹한다: `reservationId` 로 누구인지 찾을 수는 있지만, 화면이 도와줄 일은 아니다.
 */
export function ConsoleReviewList({ initial, readOnly }: { initial: Row[]; readOnly: boolean }) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(id: string) {
    setBusy(true);
    const r = await apiPut(`/api/console/reviews/${id}/reply`, { content: draft.trim() });
    setBusy(false);
    if (!r.ok) return setErr(describeError(r));
    setErr(null);
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, reply: { content: draft.trim(), at: new Date().toISOString() } } : x)));
    setEditing(null);
  }

  async function remove(id: string) {
    setBusy(true);
    const r = await apiDelete(`/api/console/reviews/${id}/reply`);
    setBusy(false);
    if (!r.ok) return setErr(describeError(r));
    setErr(null);
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, reply: null } : x)));
  }

  if (rows.length === 0) return <p className="sub">아직 리뷰가 없어요. 방문을 마친 손님이 30일 안에 남길 수 있습니다.</p>;

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}
      <ul className="review-list">
        {rows.map((r) => (
          <li key={r.id} className="review">
            <div className="review__top">
              <Stars value={r.rating} />
              <b>{r.author}</b>
              <span className="sub">{r.productName}</span>
              <span className="sub review__at">{fmt(r.at)}</span>
            </div>
            <p className="review__body">{r.content}</p>

            {editing === r.id ? (
              <div className="review__report">
                <textarea className="textarea" rows={3} maxLength={500} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="답글" />
                <div className="actions">
                  <Button type="button" variant="primary" loading={busy} disabled={!draft.trim()} onClick={() => void save(r.id)}>
                    답글 저장
                  </Button>
                  <Button type="button" onClick={() => setEditing(null)} disabled={busy}>
                    취소
                  </Button>
                </div>
              </div>
            ) : r.reply ? (
              <div className="review__reply">
                <b>내 답글</b> <span className="sub">{fmt(r.reply.at)}</span>
                <p>{r.reply.content}</p>
                {!readOnly && (
                  <div className="actions">
                    <Button type="button" size="sm" onClick={() => (setEditing(r.id), setDraft(r.reply!.content))}>
                      고치기
                    </Button>
                    <Button type="button" size="sm" loading={busy} onClick={() => void remove(r.id)}>
                      답글 지우기
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              !readOnly && (
                <div className="actions">
                  <Button type="button" size="sm" onClick={() => (setEditing(r.id), setDraft(""))}>
                    답글 달기
                  </Button>
                </div>
              )
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
