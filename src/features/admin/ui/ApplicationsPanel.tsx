"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { ApplicationItem } from "@/features/admin/businesses";
import { apiPost, describeError } from "@/lib/client-api";

/**
 * 가입 심사 (FR-ADM-010, #65).
 *
 * 화면이 지는 책임은 **반려 사유를 반드시 받는 것** 하나다. 사유 없는 반려는 사업자에게
 * "안 됩니다" 만 남기고, 그러면 같은 신청이 그대로 다시 들어온다.
 */
export function ApplicationsPanel({ initial, status }: { initial: ApplicationItem[]; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    if (decision === "REJECT" && !reason.trim()) {
      setMsg({ kind: "error", text: "반려 사유를 적어 주세요. 사업자에게 그대로 전달됩니다." });
      return;
    }
    setBusy(id);
    setMsg(null);
    const r = await apiPost(`/api/admin/applications/${id}`, { decision, reason: decision === "REJECT" ? reason.trim() : null });
    setBusy(null);
    if (!r.ok) {
      setMsg({ kind: "error", text: r.error === "NOT_PENDING" ? "이미 처리된 신청이에요. 새로 고쳐 주세요." : r.error === "EMAIL_UNVERIFIED" ? "이메일 검증 전 신청이라 심사할 수 없어요." : describeError(r) });
      return;
    }
    setRejecting(null);
    setReason("");
    setMsg({ kind: "ok", text: decision === "APPROVE" ? "승인했어요. 예약 페이지가 공개되고 사업자에게 메일이 나갔어요." : "반려했어요. 사유와 함께 메일이 나갔어요." });
    router.refresh();
  }

  return (
    <>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {initial.length === 0 ? (
        <p className="sub">{status === "PENDING" ? "심사할 신청이 없어요." : "해당하는 신청이 없어요."}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {initial.map((a) => (
            <li key={a.id} className="card">
              <p style={{ margin: 0, fontWeight: 600 }}>
                {a.name} <span className="sub" style={{ fontWeight: 400 }}>/@{a.slug}</span>
              </p>
              <p className="sub" style={{ margin: "4px 0" }}>
                {a.category} · 사업자번호 {a.bizRegNo} · 대표 {a.ownerName} ({a.ownerEmail})
              </p>
              <p className="sub" style={{ margin: "4px 0" }}>
                {a.phone ?? "연락처 없음"} · {a.address ?? "주소 없음"} · 신청 {new Date(a.createdAt).toLocaleDateString("ko-KR")}
              </p>
              {a.rejectedReason && <p style={{ margin: "4px 0" }}>반려 사유: {a.rejectedReason}</p>}
              {a.status === "PENDING" && (
                <div style={{ marginTop: 10 }}>
                  {rejecting === a.id ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <label htmlFor={`r-${a.id}`} className="sub">
                        반려 사유 — 사업자에게 그대로 전달됩니다
                      </label>
                      <textarea id={`r-${a.id}`} className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button size="sm" variant="danger" loading={busy === a.id} onClick={() => decide(a.id, "REJECT")}>
                          반려하기
                        </Button>
                        <Button size="sm" onClick={() => { setRejecting(null); setReason(""); }}>
                          취소
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button size="sm" variant="primary" loading={busy === a.id} onClick={() => decide(a.id, "APPROVE")}>
                        승인
                      </Button>
                      <Button size="sm" onClick={() => setRejecting(a.id)}>
                        반려
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
