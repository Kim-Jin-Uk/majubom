"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Input } from "@/components/ui";
import type { BusinessPolicy } from "@/db/schema";
import { apiPut, describeError, fieldErrors } from "@/lib/client-api";

type NumKey = "minLeadTimeMin" | "maxAdvanceDays" | "cancelDeadlineHours" | "maxActivePerCustomer" | "autoNoShowAfterHours" | "requestExpireHours";
type BoolKey = "autoConfirm" | "reviewEnabled" | "shiftAutoApprove";

const BOOLS: Array<[BoolKey, string, string]> = [
  ["autoConfirm", "예약 자동 확정", "끄면 고객 예약이 '대기'로 들어오고 사장님이 승인해야 확정돼요. 승인 없이 지나면 아래 시간 뒤 자동 만료"],
  ["reviewEnabled", "리뷰 받기", "이용을 마친 고객이 리뷰를 남길 수 있어요. 끄면 리뷰 탭이 숨겨집니다"],
  ["shiftAutoApprove", "담당자 근무표 변경 자동 승인", "매니저가 자기 근무표를 바꿀 때 사장님 승인 없이 바로 반영"],
];
const NUMS: Array<[NumKey, string, string, string]> = [
  ["minLeadTimeMin", "최소 예약 선행 시간", "분", "지금부터 이 시간 안쪽 슬롯은 예약할 수 없어요 (60 = 1시간 전까지만)"],
  ["maxAdvanceDays", "최대 예약 가능 기간", "일", "오늘부터 며칠 뒤까지 열어 둘지"],
  ["cancelDeadlineHours", "취소 마감", "시간 전", "이 시간 이후엔 고객이 직접 취소할 수 없어요. 이미 잡힌 예약에는 적용되지 않습니다"],
  ["maxActivePerCustomer", "고객 1명당 동시 예약 수", "건", "확정·대기 예약을 합쳐 이 수까지"],
  ["requestExpireHours", "대기 예약 자동 만료", "시간", "자동 확정을 껐을 때, 승인하지 않으면 이 시간 뒤 만료"],
  ["autoNoShowAfterHours", "노쇼 자동 처리", "시간 후", "예약 시각이 지나고 이 시간 뒤까지 처리하지 않으면 노쇼로 기록"],
];

/** 예약 정책 (FR-BIZ-020, #27). 위저드 5단계 · 설정 화면 공용. 변경은 미래 예약에만 적용된다 */
export function PolicyForm({ initial, mode, readOnly }: { initial: BusinessPolicy; mode: "wizard" | "settings"; readOnly: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<Record<string, string | boolean>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) body[k] = typeof v === "boolean" ? v : Number(v);
    const r = await apiPut("/api/console/policy", body);
    setBusy(false);
    if (!r.ok) {
      if (r.issues) {
        setErrors(fieldErrors(r.issues));
        setMsg({ kind: "error", text: "범위를 벗어난 값이 있어요" });
      } else setMsg({ kind: "error", text: describeError(r) });
      return;
    }
    if (mode === "wizard") {
      router.push("/console");
      router.refresh();
      return;
    }
    setMsg({ kind: "ok", text: "저장했습니다. 앞으로 들어오는 예약부터 적용됩니다" });
    router.refresh();
  }

  return (
    <form className="panel" onSubmit={save}>
      <h2>예약 정책</h2>
      <p className="sub">정책을 바꿔도 이미 잡힌 예약은 예약 당시의 규칙을 따릅니다 — 고객과의 약속을 뒤에서 바꾸지 않아요.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div>
        {BOOLS.map(([k, label, hint]) => (
          <div key={k} className="toggle-row">
            <div>
              <b>{label}</b>
              <span className="hint">{hint}</span>
            </div>
            <label className="check" style={{ flexShrink: 0 }}>
              <input type="checkbox" checked={Boolean(p[k])} onChange={(e) => setP((x) => ({ ...x, [k]: e.target.checked }))} disabled={readOnly || busy} />
              {p[k] ? "켬" : "끔"}
            </label>
          </div>
        ))}
        {NUMS.map(([k, label, unit, hint]) => (
          <div key={k} className="toggle-row">
            <div>
              <b>{label}</b>
              <span className="hint">{hint}</span>
              {errors[k] && (
                <span className="hint" style={{ color: "var(--bad)" }} role="alert">
                  {errors[k]}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Input type="number" aria-label={label} value={String(p[k])} onChange={(e) => setP((x) => ({ ...x, [k]: e.target.value }))} disabled={readOnly || busy} aria-invalid={!!errors[k]} required />
              <span className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                {unit}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="actions">
        {!readOnly && (
          <Button type="submit" variant="primary" loading={busy}>
            {mode === "wizard" ? "저장하고 마치기" : "저장"}
          </Button>
        )}
        {mode === "wizard" && (
          <Link href="/console" className="btn">
            {readOnly ? "콘솔 홈" : "건너뛰기"}
          </Link>
        )}
      </div>
    </form>
  );
}
