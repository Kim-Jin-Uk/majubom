"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Toast } from "@/components/ui";
import { apiPatch, describeError } from "@/lib/client-api";
import type { ReservationDetail } from "../console";
import type { ReservationStatus } from "../slot-types";
import { rangeLabel, stampLabel, STATUS_COLOR, STATUS_LABEL, VIA_LABEL } from "./status";

/**
 * 예약 상세 (FR-BOOK-080, #61). 승인·거절·매장 취소·완료·노쇼·담당 변경.
 *
 * 어떤 전이가 가능한지는 서버의 표(`transition-rules.ts`)가 정본이다 — 여기서는 **버튼을 보일지**만 정하고,
 * 시각 조건(완료는 시작 후, 노쇼는 종료 후)까지 흉내 내지 않는다. 이르면 서버가 409 `TOO_EARLY` 를 주고 토스트로 알린다.
 * 사유가 필요한 전이는 눌렀을 때 입력칸을 펼치고, 비어 있으면 보내지 않는다(서버도 400 으로 막는다).
 */

type Action = { to: ReservationStatus; label: string; variant?: "primary" | "danger"; reason?: boolean; ownerOnly?: boolean };

const ACTIONS: Partial<Record<ReservationStatus, Action[]>> = {
  REQUESTED: [
    { to: "CONFIRMED", label: "승인", variant: "primary" },
    { to: "REJECTED", label: "거절", variant: "danger", reason: true },
    { to: "CANCELED_BY_BIZ", label: "매장 취소", reason: true },
  ],
  CONFIRMED: [
    { to: "COMPLETED", label: "완료 처리", variant: "primary" },
    { to: "NO_SHOW", label: "노쇼 처리", variant: "danger" },
    { to: "CANCELED_BY_BIZ", label: "매장 취소", reason: true },
  ],
  COMPLETED: [{ to: "NO_SHOW", label: "노쇼로 정정", reason: true, ownerOnly: true }],
  NO_SHOW: [{ to: "COMPLETED", label: "완료로 정정", reason: true, ownerOnly: true }],
};

export function ReservationDetailPanel({ detail, role, readOnly, resources }: { detail: ReservationDetail; role: "OWNER" | "MANAGER"; readOnly: boolean; resources: Array<{ id: string; name: string; isActive: boolean }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [moveTo, setMoveTo] = useState("");

  // 정지된 사업장의 콘솔은 읽기 전용이지만 매장 취소만은 열려 있다 (FR-ADM-020)
  const allowed = (ACTIONS[detail.status] ?? []).filter((a) => (!a.ownerOnly || role === "OWNER") && (!readOnly || a.to === "CANCELED_BY_BIZ"));

  async function run(a: Action, why: string) {
    setBusy(true);
    const r = await apiPatch(`/api/console/reservations/${detail.id}/status`, { status: a.to, reason: why || null });
    setBusy(false);
    if (!r.ok) {
      setToast({ kind: "error", text: transitionError(r.error) ?? describeError(r) });
      return;
    }
    setPending(null);
    setReason("");
    setToast({ kind: "ok", text: `${a.label} 처리했어요` });
    router.refresh();
  }

  async function reassign() {
    if (!moveTo || moveTo === detail.resourceId) return;
    setBusy(true);
    const r = await apiPatch(`/api/console/reservations/${detail.id}`, { resourceId: moveTo });
    setBusy(false);
    if (!r.ok) {
      setToast({ kind: "error", text: transitionError(r.error) ?? describeError(r) });
      return;
    }
    setMoveTo("");
    setToast({ kind: "ok", text: "담당을 변경했어요" });
    router.refresh();
  }

  const [bg, fg] = STATUS_COLOR[detail.status];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel">
        <div className="rsv-head">
          <div>
            <span className="tag" style={{ background: bg, color: fg }}>
              {STATUS_LABEL[detail.status]}
            </span>
            <b style={{ marginLeft: 8 }}>{detail.productName}</b>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              예약번호 {detail.code} · {VIA_LABEL[detail.createdVia]} 예약 · {stampLabel(detail.createdAt)} 접수
            </div>
          </div>
        </div>
        <dl className="rsv-dl">
          <dt>일시</dt>
          <dd>
            {detail.startAt.slice(0, 10)} {rangeLabel(detail.startAt, detail.endAt)} ({detail.durationMin}분)
          </dd>
          <dt>담당 · 공간</dt>
          <dd>{detail.resourceName}</dd>
          <dt>인원</dt>
          <dd>{detail.partySize}명</dd>
          <dt>고객</dt>
          <dd>
            {detail.customerName || "이름 없음"}
            {detail.customerEmail && <span className="muted"> · {detail.customerEmail}</span>}
            {detail.customerPhone && <span className="muted"> · {detail.customerPhone}</span>}
            {detail.createdVia === "WALK_IN" && <span className="muted"> · 현장에서 받아 적은 이름이에요</span>}
          </dd>
          {detail.customerNote && (
            <>
              <dt>요청사항</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{detail.customerNote}</dd>
            </>
          )}
          {detail.internalMemo && (
            <>
              <dt>내부 메모</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{detail.internalMemo}</dd>
            </>
          )}
          {detail.cancelReason && (
            <>
              <dt>취소 사유</dt>
              <dd>
                {detail.cancelReason}
                {detail.canceledAt && <span className="muted"> · {stampLabel(detail.canceledAt)}</span>}
              </dd>
            </>
          )}
          {detail.noShowSource && (
            <>
              <dt>노쇼 처리</dt>
              <dd>{detail.noShowSource === "AUTO" ? "자동 (이용 시간이 지나도록 처리되지 않음)" : "직접 처리"}</dd>
            </>
          )}
        </dl>
      </section>

      {allowed.length > 0 && (
        <section className="panel">
          <h2>처리</h2>
          <div className="actions">
            {allowed.map((a) => (
              <Button key={a.to} variant={a.variant ?? "default"} disabled={busy} onClick={() => (a.reason ? (setPending(a), setReason("")) : void run(a, ""))}>
                {a.label}
              </Button>
            ))}
          </div>
          {pending && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="rsv-reason" style={{ fontSize: 13, fontWeight: 600 }}>
                {pending.label} 사유 (고객에게 전달돼요)
              </label>
              <input id="rsv-reason" className="input" value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="예: 담당자 사정으로 그 시간에 운영이 어려워요" />
              <div className="actions">
                <Button variant="primary" disabled={busy || !reason.trim()} loading={busy} onClick={() => void run(pending, reason.trim())}>
                  {pending.label} 확정
                </Button>
                <Button onClick={() => setPending(null)} disabled={busy}>
                  그만두기
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {role === "OWNER" && !readOnly && (detail.status === "REQUESTED" || detail.status === "CONFIRMED") && (
        <section className="panel">
          <h2>담당 · 공간 변경</h2>
          <p className="sub">시간은 그대로 두고 자원만 옮겨요. 옮길 곳이 그 시간에 차 있으면 바뀌지 않아요. 시간을 바꾸는 것은 고객의 예약 변경이에요.</p>
          <div className="actions">
            <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="옮길 담당·공간">
              <option value="">선택</option>
              {resources
                .filter((r) => r.id !== detail.resourceId && r.isActive)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
            <Button variant="primary" disabled={busy || !moveTo} loading={busy} onClick={() => void reassign()}>
              옮기기
            </Button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>이력</h2>
        {detail.history.length === 0 ? (
          <Alert kind="info">아직 상태가 바뀐 적이 없어요.</Alert>
        ) : (
          <ol className="rsv-log">
            {detail.history.map((h, i) => (
              <li key={i}>
                <span className="muted">{stampLabel(h.at)}</span> {h.from && h.from !== h.to ? `${STATUS_LABEL[h.from]} → ${STATUS_LABEL[h.to]}` : "담당 변경"}
                {h.actorName && <span className="muted"> · {h.actorName}</span>}
                {h.reason && <div className="muted">{h.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {toast && (
        <Toast kind={toast.kind} onClose={() => setToast(null)}>
          {toast.text}
        </Toast>
      )}
    </div>
  );
}

/** 전이 전용 오류 — 공통 describeError 가 모르는 코드만 여기서 문구를 준다 */
function transitionError(code: string): string | null {
  switch (code) {
    case "INVALID_TRANSITION":
      return "그 사이 상태가 바뀌었어요. 새로 고친 뒤 다시 확인해 주세요";
    case "REASON_REQUIRED":
      return "사유를 입력해 주세요";
    case "TOO_EARLY":
      return "아직 이 처리를 할 시간이 아니에요 (완료는 시작 후, 노쇼는 종료 후)";
    case "SLOT_TAKEN":
      return "그 시간에 자리가 없어요. 다른 담당·공간을 골라 주세요";
    case "RESOURCE_NOT_LINKED":
      return "그 자원은 이 상품에 연결돼 있지 않아요";
    case "RESOURCE_INACTIVE":
      return "비활성 상태인 자원이에요. 먼저 다시 활성화해 주세요";
    case "PRODUCT_GONE":
      return "상품이 보관 처리돼 있어요. 상품을 되살린 뒤 다시 시도해 주세요";
    case "NOT_OWN_RESOURCE":
      return "내가 담당하는 예약만 처리할 수 있어요";
    default:
      return null;
  }
}
