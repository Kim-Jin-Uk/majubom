"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { ApplicationItem } from "@/features/admin/businesses";
import { apiPost, describeError } from "@/lib/client-api";

const STATUS_TEXT: Record<string, string> = { APPROVED: "운영 중", SUSPENDED: "일시정지", BLOCKED: "차단", PENDING: "심사 대기", REJECTED: "반려" };

type Pending = { id: string; status: "SUSPENDED" | "BLOCKED" | "APPROVED" };

/**
 * 사업장 상태 제어 (FR-ADM-020, #66).
 *
 * 차단은 그 가게로 잡힌 예약을 전부 무의미하게 만든다. 그래서 남은 예약이 있으면 서버가 한 번 막고,
 * 화면은 **"함께 취소" 와 "그대로 두기" 를 명시적으로 고르게** 한다 — 기본값을 두면 아무도 읽지 않는다.
 */
export function BusinessesPanel({ initial }: { initial: ApplicationItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [live, setLive] = useState<number | null>(null);

  async function submit(cancelReservations?: boolean, confirmReservations?: boolean) {
    if (!pending) return;
    if (!reason.trim()) {
      setMsg({ kind: "error", text: "사유를 적어 주세요. 사업자에게 그대로 전달됩니다." });
      return;
    }
    setBusy(pending.id);
    setMsg(null);
    const r = await apiPost<{ canceled: number }>(`/api/admin/businesses/${pending.id}/status`, { status: pending.status, reason: reason.trim(), cancelReservations, confirmReservations });
    setBusy(null);
    if (!r.ok) {
      if (r.error === "LIVE_RESERVATIONS") {
        setLive(Number(r.data?.count ?? 0));
        setMsg({ kind: "warn", text: `앞으로 잡힌 예약이 ${r.data?.count ?? 0}건 남아 있어요. 함께 취소할지 정해 주세요.` });
        return;
      }
      setMsg({ kind: "error", text: r.error === "SAME_STATUS" ? "이미 그 상태예요." : r.error === "NOT_APPROVED" ? "아직 심사가 끝나지 않은 사업장이에요." : describeError(r) });
      return;
    }
    setPending(null);
    setReason("");
    setLive(null);
    setMsg({ kind: "ok", text: r.data.canceled > 0 ? `상태를 바꿨어요. 남아 있던 예약 ${r.data.canceled}건을 취소하고 손님에게 안내했어요.` : "상태를 바꿨어요. 사업자에게 메일이 나갔어요." });
    router.refresh();
  }

  return (
    <>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {initial.map((b) => (
          <li key={b.id} className="card">
            <p style={{ margin: 0, fontWeight: 600 }}>
              {b.name} <span className="sub" style={{ fontWeight: 400 }}>/@{b.slug} · {STATUS_TEXT[b.status] ?? b.status}</span>
            </p>
            <p className="sub" style={{ margin: "4px 0" }}>
              {b.category} · 사업자번호 {b.bizRegNo} · 대표 {b.ownerName} ({b.ownerEmail})
            </p>
            {pending?.id === b.id ? (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <label htmlFor={`why-${b.id}`} className="sub">
                  사유 — 사업자에게 그대로 전달됩니다
                </label>
                <textarea id={`why-${b.id}`} className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                {live !== null && live > 0 ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button size="sm" variant="danger" loading={busy === b.id} onClick={() => submit(true, false)}>
                      예약 {live}건도 함께 취소하고 차단
                    </Button>
                    <Button size="sm" loading={busy === b.id} onClick={() => submit(false, true)}>
                      예약은 그대로 두고 차단
                    </Button>
                    <Button size="sm" onClick={() => { setPending(null); setLive(null); setReason(""); }}>
                      그만두기
                    </Button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" variant={pending.status === "APPROVED" ? "primary" : "danger"} loading={busy === b.id} onClick={() => submit()}>
                      {pending.status === "APPROVED" ? "복구하기" : pending.status === "SUSPENDED" ? "일시정지하기" : "차단하기"}
                    </Button>
                    <Button size="sm" onClick={() => { setPending(null); setReason(""); }}>
                      그만두기
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {b.status !== "SUSPENDED" && (
                  <Button size="sm" onClick={() => { setPending({ id: b.id, status: "SUSPENDED" }); setLive(null); setMsg(null); }}>
                    일시정지
                  </Button>
                )}
                {b.status !== "BLOCKED" && (
                  <Button size="sm" variant="danger" onClick={() => { setPending({ id: b.id, status: "BLOCKED" }); setLive(null); setMsg(null); }}>
                    차단
                  </Button>
                )}
                {b.status !== "APPROVED" && (
                  <Button size="sm" variant="primary" onClick={() => { setPending({ id: b.id, status: "APPROVED" }); setLive(null); setMsg(null); }}>
                    복구
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {initial.length === 0 && <p className="sub">사업장이 없어요.</p>}
    </>
  );
}
