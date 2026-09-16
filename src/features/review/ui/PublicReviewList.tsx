"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { PublicReview } from "@/features/review/reviews";
import { apiPost, describeError } from "@/lib/client-api";
import { Stars } from "./StarRating";

const REPORT_ERROR: Record<string, string> = {
  ALREADY_REPORTED: "이미 신고하신 리뷰예요. 검토 중입니다.",
  OWN_REVIEW: "내가 쓴 리뷰는 신고 대신 삭제하실 수 있어요.",
  ADMIN_CANNOT_REPORT: "운영자 계정으로는 신고할 수 없어요.",
  UNAUTHENTICATED: "신고하려면 로그인이 필요해요.",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });

/**
 * 공개 리뷰 목록 (FR-REV-020, #93) + 신고 입구 (#94).
 *
 * **사업자에게는 숨김·삭제 버튼이 없다.** 임의로 지울 수 있으면 리뷰 신뢰도가 0 이 된다 —
 * 부적절한 글은 신고 → 관리자 검토다. 그래서 신고는 손님·사업자 누구에게나 같은 버튼이다.
 */
export function PublicReviewList({ items, signedIn }: { items: Array<Omit<PublicReview, "at" | "reply"> & { at: string; reply: { content: string; at: string } | null }>; signedIn: boolean }) {
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  async function send(id: string) {
    setBusy(true);
    const r = await apiPost(`/api/reviews/${id}/report`, { reason: reason.trim() });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: REPORT_ERROR[r.error] ?? describeError(r) });
      return;
    }
    setDone((s) => new Set(s).add(id));
    setReporting(null);
    setReason("");
    setMsg({ kind: "ok", text: "신고를 접수했어요. 검토하는 동안 이 리뷰는 보이지 않습니다." });
  }

  if (items.length === 0) return <p className="sub">아직 이 조건의 리뷰가 없어요.</p>;

  return (
    <>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <ul className="review-list">
        {items.map((r) => (
          <li key={r.id} className="review">
            <div className="review__top">
              <Stars value={r.rating} />
              <b>{r.author}</b>
              <span className="sub">{r.productName}</span>
              <span className="sub review__at">{fmt(r.at)}</span>
            </div>
            <p className="review__body">{r.content}</p>

            {r.reply && (
              /* 답글은 리뷰 안에 들여 쓴다 — 별도 줄로 빼면 누구의 말인지 흐려진다 */
              <div className="review__reply">
                <b>사장님 답글</b> <span className="sub">{fmt(r.reply.at)}</span>
                <p>{r.reply.content}</p>
              </div>
            )}

            {done.has(r.id) ? (
              <p className="sub">신고 접수됨</p>
            ) : reporting === r.id ? (
              <div className="review__report">
                <textarea
                  className="textarea"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="무엇이 문제인지 알려 주세요 (5자 이상)"
                  aria-label="신고 사유"
                />
                <div className="actions">
                  <Button type="button" variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => void send(r.id)}>
                    신고 보내기
                  </Button>
                  <Button type="button" onClick={() => setReporting(null)} disabled={busy}>
                    그만두기
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="review__report-link"
                onClick={() => (signedIn ? (setReporting(r.id), setReason(""), setMsg(null)) : setMsg({ kind: "error", text: "신고하려면 로그인이 필요해요." }))}
              >
                신고
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
