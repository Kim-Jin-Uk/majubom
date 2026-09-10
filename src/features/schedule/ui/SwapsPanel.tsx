"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";
import type { SwapAction, SwapStatus } from "@/features/schedule/swap-rules";
import type { SwapItem } from "@/features/schedule/swaps";

const STATUS_TEXT: Record<SwapStatus, string> = {
  PENDING: "응답 대기",
  ACCEPTED: "사장님 승인 대기",
  APPROVED: "반영됨",
  REJECTED: "상대가 거절",
  DENIED: "사장님이 거부",
  CANCELED: "철회함",
  EXPIRED: "기간 만료",
};
const ACTION_TEXT: Record<SwapAction, string> = { ACCEPT: "수락", REJECT: "거절", CANCEL: "철회", APPROVE: "승인", DENY: "거부", EXPIRE: "" };

/** 진행 중인 것만 강조한다 — 끝난 요청은 이력이라 색을 뺀다 */
const OPEN: SwapStatus[] = ["PENDING", "ACCEPTED"];

type Staff = { id: string; name: string };
type Draft = { targetResourceId: string; swapType: "GIVE" | "EXCHANGE"; requestDate: string; targetDate: string; reason: string; reassignRequester: boolean; reassignTarget: boolean };

/**
 * 근무 교대 (FR-SHIFT-010~030, #44~#46).
 *
 * 화면이 짊어지는 것은 **"예약을 어떻게 할지 먼저 정하게 만드는 것"** 하나다. 근무만 넘기고 예약을 잊으면
 * 그날 손님이 아무도 없는 가게에 온다(리스크 R4). 그래서 이관 여부가 기본값 없는 라디오이고,
 * 승인 단계에서 서버가 막으면 이유를 그대로 보여 준다.
 */
export function SwapsPanel({ initial, staff, myResourceId, today, readOnly }: { initial: SwapItem[]; staff: Staff[]; myResourceId: string | null; today: string; readOnly: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>({ targetResourceId: staff[0]?.id ?? "", swapType: "GIVE", requestDate: "", targetDate: "", reason: "", reassignRequester: false, reassignTarget: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setErrors({});
    setMsg(null);
    const r = await apiPost<{ reservationCount: number }>("/api/console/swaps", {
      targetResourceId: d.targetResourceId,
      swapType: d.swapType,
      requestDate: d.requestDate,
      targetDate: d.swapType === "EXCHANGE" ? d.targetDate : null,
      reason: d.reason,
      reassignRequester: d.reassignRequester,
      reassignTarget: d.swapType === "EXCHANGE" ? d.reassignTarget : null,
    });
    setBusy(null);
    if (!r.ok) {
      setErrors(fieldErrors(r.issues));
      setMsg({ kind: "error", text: swapError(r.error) ?? describeError(r) });
      return;
    }
    setMsg({ kind: "ok", text: r.data.reservationCount > 0 ? `교대를 요청했어요. 그날 예약 ${r.data.reservationCount}건이 함께 처리돼요.` : "교대를 요청했어요." });
    setD((x) => ({ ...x, requestDate: "", targetDate: "", reason: "" }));
    router.refresh();
  }

  async function act(id: string, action: SwapAction, confirmDirectPicks = false) {
    setBusy(id);
    setMsg(null);
    const r = await apiPost(`/api/console/swaps/${id}`, { action, confirmDirectPicks });
    setBusy(null);
    if (!r.ok) {
      if (r.error === "SWAP_DIRECT_PICKS") {
        const names = ((r.data?.reservations as Array<{ code: string }>) ?? []).map((x) => x.code).join(", ");
        setMsg({ kind: "warn", text: `담당자를 직접 고른 손님의 예약이 있어요 (${names}). 그래도 옮기려면 한 번 더 눌러 주세요.` });
        setConfirmId(id);
        return;
      }
      setMsg({ kind: "error", text: swapError(r.error, r.data) ?? describeError(r) });
      return;
    }
    setConfirmId(null);
    setMsg({ kind: "ok", text: action === "APPROVE" || action === "ACCEPT" ? "근무표에 반영했어요." : "처리했어요." });
    router.refresh();
  }

  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {!readOnly && myResourceId && staff.length > 0 && (
        <form onSubmit={create} className="card" style={{ display: "grid", gap: 12, marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>교대 요청</h2>
          <Field label="누구와" htmlFor="sw-target">
            <select id="sw-target" className="select" value={d.targetResourceId} onChange={(e) => set("targetResourceId", e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="교대 방식" htmlFor="sw-type">
            <select id="sw-type" className="select" value={d.swapType} onChange={(e) => set("swapType", e.target.value as Draft["swapType"])}>
              <option value="GIVE">내 근무를 넘긴다</option>
              <option value="EXCHANGE">서로 바꾼다</option>
            </select>
          </Field>
          <Field label="내 근무일" htmlFor="sw-date" error={errors.requestDate}>
            <Input id="sw-date" type="date" min={today} value={d.requestDate} onChange={(e) => set("requestDate", e.target.value)} required />
          </Field>
          {d.swapType === "EXCHANGE" && (
            <Field label="상대 근무일" htmlFor="sw-target-date" error={errors.targetDate}>
              <Input id="sw-target-date" type="date" min={today} value={d.targetDate} onChange={(e) => set("targetDate", e.target.value)} required />
            </Field>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sub" style={{ padding: 0 }}>그날 내 예약은</legend>
            <label style={{ display: "block" }}>
              <input type="radio" name="reassign-req" checked={d.reassignRequester} onChange={() => set("reassignRequester", true)} /> 상대에게 넘긴다 — 손님에게 담당자 변경을 알려요
            </label>
            <label style={{ display: "block" }}>
              <input type="radio" name="reassign-req" checked={!d.reassignRequester} onChange={() => set("reassignRequester", false)} /> 내가 그 시간만 나온다 — 손님에게는 알리지 않아요
            </label>
          </fieldset>
          {d.swapType === "EXCHANGE" && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="sub" style={{ padding: 0 }}>그날 상대 예약은</legend>
              <label style={{ display: "block" }}>
                <input type="radio" name="reassign-tgt" checked={d.reassignTarget} onChange={() => set("reassignTarget", true)} /> 내가 맡는다
              </label>
              <label style={{ display: "block" }}>
                <input type="radio" name="reassign-tgt" checked={!d.reassignTarget} onChange={() => set("reassignTarget", false)} /> 상대가 그 시간만 나온다
              </label>
            </fieldset>
          )}
          <Field label="사유" htmlFor="sw-reason" error={errors.reason}>
            <Input id="sw-reason" value={d.reason} onChange={(e) => set("reason", e.target.value)} maxLength={300} required placeholder="상대가 보고 판단할 내용을 적어 주세요" />
          </Field>
          <Button type="submit" loading={busy === "create"}>
            교대 요청하기
          </Button>
        </form>
      )}

      {!myResourceId && <p className="sub">교대는 담당자 자원이 연결된 계정만 요청할 수 있어요.</p>}

      <h2 style={{ fontSize: 16 }}>교대 요청</h2>
      {initial.length === 0 ? (
        <p className="sub">아직 교대 요청이 없어요.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {initial.map((s) => (
            <li key={s.id} className="card" style={{ opacity: OPEN.includes(s.status) ? 1 : 0.7 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {s.requesterName} → {s.targetName} · {s.requestDate}
                {s.targetDate ? ` ↔ ${s.targetDate}` : ""}
              </p>
              <p className="sub" style={{ margin: "4px 0" }}>
                {s.swapType === "GIVE" ? "근무 넘기기" : "맞교대"} · {STATUS_TEXT[s.status]}
                {s.reservationCount > 0 ? ` · 그날 예약 ${s.reservationCount}건` : " · 그날 예약 없음"}
                {s.expiresAt ? ` · ${new Date(s.expiresAt).toLocaleString("ko-KR")} 까지 응답` : ""}
              </p>
              <p style={{ margin: "4px 0" }}>{s.reason}</p>
              {!readOnly && s.can.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {s.can.map((a) => (
                    <Button key={a} size="sm" variant={a === "REJECT" || a === "DENY" ? "danger" : a === "CANCEL" ? "default" : "primary"} loading={busy === s.id} onClick={() => act(s.id, a, confirmId === s.id)}>
                      {ACTION_TEXT[a]}
                      {confirmId === s.id && a === "APPROVE" ? " (확인)" : ""}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 서버 코드 → 사람 말. 모르는 코드는 null 을 돌려 공통 문구로 넘긴다 */
function swapError(code: string, data?: Record<string, unknown>): string | null {
  switch (code) {
    case "SWAP_EXISTS":
      return "그 사람과 그날 진행 중인 교대 요청이 이미 있어요.";
    case "NO_SHIFT_TO_SWAP":
      return "그날은 넘길 근무가 없어요.";
    case "TARGET_ALREADY_WORKING":
      return "상대가 그날 이미 근무해요. 맞교대로 바꾸거나 다른 날을 골라 주세요.";
    case "SHIFT_CROSSES_MIDNIGHT":
      return "자정을 넘기는 근무는 아직 교대할 수 없어요.";
    case "NO_OWN_RESOURCE":
      return "교대는 담당자 자원이 연결된 계정만 요청할 수 있어요.";
    case "SWAP_RESERVATIONS_CHANGED":
      return "요청한 뒤 그날 예약이 달라졌어요. 목록을 새로 고쳐 다시 확인해 주세요.";
    case "SWAP_CONFLICT": {
      const list = (data?.conflicts as Array<{ code: string; reason: string }>) ?? [];
      const why = { PRODUCT_RESOURCE: "그 상품을 맡을 수 없어요", OUTSIDE_WORK: "근무 시간 밖이에요", CAPACITY: "정원이 찼어요" } as Record<string, string>;
      return `옮길 수 없는 예약이 있어요 — ${list.map((c) => `${c.code}(${why[c.reason] ?? c.reason})`).join(", ")}`;
    }
    case "INVALID_SWAP_ACTION":
      return "이미 처리된 요청이에요. 새로 고쳐 주세요.";
    default:
      return null;
  }
}
