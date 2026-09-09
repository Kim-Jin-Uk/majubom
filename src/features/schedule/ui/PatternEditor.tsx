"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { ResourceItem } from "@/features/business/resources";
import type { PatternView } from "@/features/schedule/work-schedules";
import { apiPut, describeError, fieldErrors } from "@/lib/client-api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
type Row = { enabled: boolean; startTime: string; endTime: string; breaks: Array<{ start: string; end: string }> };

function fromView(v: PatternView | null): Row[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const cur = v?.current.find((r) => r.dayOfWeek === dow);
    return cur ? { enabled: true, startTime: cur.startTime, endTime: cur.endTime, breaks: cur.breaks ?? [] } : { enabled: false, startTime: "10:00", endTime: "19:00", breaks: [] };
  });
}

/**
 * 주간 근무 패턴 편성 (FR-SCH-020, #39). 담당자 하나를 골라 7일 패턴 + 적용 시작일. "다른 담당자에게도" 로 일괄 적용.
 * 저장은 새 버전을 만든다 — 이전 패턴은 그 전날로 닫히고 이력에 남는다.
 */
export function PatternEditor({ staff, selected, view, today, readOnly }: { staff: ResourceItem[]; selected: string | null; view: PatternView | null; today: string; readOnly: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => fromView(view));
  const [seen, setSeen] = useState(view);
  if (view !== seen) {
    setSeen(view);
    setRows(fromView(view));
  }
  const [from, setFrom] = useState(today);
  const [also, setAlso] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function copyToAll(i: number) {
    const src = rows[i];
    setRows((rs) => rs.map((r) => (r.enabled ? { ...r, startTime: src.startTime, endTime: src.endTime, breaks: src.breaks.map((b) => ({ ...b })) } : r)));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setErrors({});
    setMsg(null);
    const days = rows.flatMap((r, dow) => (r.enabled ? [{ dow, startTime: r.startTime, endTime: r.endTime, breaks: r.breaks.filter((b) => b.start && b.end) }] : []));
    const ids = [selected, ...also];
    type Res = { warnings: Array<{ resourceId: string; dow: number; reason: string }>; replacedUpcoming: number };
    const r = ids.length > 1 ? await apiPut<Res>("/api/console/work-schedules/bulk", { resourceIds: ids, effectiveFrom: from, days }) : await apiPut<Res>(`/api/console/work-schedules/${selected}`, { effectiveFrom: from, days });
    setBusy(false);
    if (!r.ok) {
      if (r.issues) {
        setErrors(fieldErrors(r.issues));
        const first = r.issues[0];
        const dayIdx = first?.path[0] === "days" && typeof first.path[1] === "number" ? days[first.path[1]]?.dow : undefined;
        setMsg({ kind: "error", text: `${dayIdx !== undefined ? `${DOW[dayIdx]}요일: ` : ""}${first?.message ?? "입력 내용을 확인해 주세요"}` });
      } else setMsg({ kind: "error", text: r.error === "CONFLICT" ? "같은 담당자의 패턴이 방금 바뀌었어요. 새로 고친 뒤 다시 시도해 주세요" : describeError(r) });
      return;
    }
    const w = r.data.warnings ?? [];
    const closedDays = [...new Set(w.filter((x) => x.reason === "CLOSED_DAY").map((x) => `${DOW[x.dow]}요일`))];
    const outside = [...new Set(w.filter((x) => x.reason === "OUTSIDE_OPENING").map((x) => `${DOW[x.dow]}요일`))];
    const notes = [
      closedDays.length ? `영업하지 않는 요일에 근무: ${closedDays.join(", ")}` : "",
      outside.length ? `영업시간 밖 근무: ${outside.join(", ")}` : "",
      r.data.replacedUpcoming ? `예정돼 있던 패턴 ${r.data.replacedUpcoming}건은 이 패턴으로 대체됐어요` : "",
    ].filter(Boolean);
    setMsg({
      kind: w.length ? "warn" : "ok",
      text: `${from} 부터 적용되는 패턴을 저장했어요${ids.length > 1 ? ` (담당자 ${ids.length}명)` : ""}.${notes.length ? ` ${notes.join(". ")} — 저장은 됐지만 영업시간 밖에는 예약이 열리지 않아요.` : ""}`,
    });
    setAlso([]);
    router.refresh();
  }

  const others = staff.filter((s) => s.id !== selected && s.isActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="chips" role="tablist" aria-label="담당자">
        {staff.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === selected} className={s.id === selected ? "chip on" : "chip"} onClick={() => router.push(`/console/schedule/pattern?resource=${s.id}`)}>
            {s.name}
            {!s.isActive && <span className="muted"> · 비활성</span>}
          </button>
        ))}
      </div>
      {!selected ? (
        <Alert kind="info">담당자를 고르면 주간 패턴을 편성할 수 있어요.</Alert>
      ) : (
        <form className="panel" onSubmit={save}>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div className="grid-2">
            <Field label="적용 시작일" htmlFor="p-from" hint="이 날부터 새 패턴. 이전 패턴은 그 전날로 끝나고 이력에 남아요" error={errors.effectiveFrom}>
              <Input id="p-from" type="date" required min={today} value={from} onChange={(e) => setFrom(e.target.value)} disabled={readOnly} />
            </Field>
            {view && view.upcoming.length > 0 && (
              <Alert kind="warn">
                예정된 패턴이 {new Set(view.upcoming.map((u) => u.effectiveFrom)).size}건 있어요 ({[...new Set(view.upcoming.map((u) => u.effectiveFrom))].join(", ")} 시작). 그보다 앞선 날부터 저장하면 예정 패턴은 지워져요.
              </Alert>
            )}
          </div>
          <div className="hours">
            {rows.map((r, i) => (
              <div key={i} className="hours-row">
                <label className="check" style={{ height: 38 }}>
                  <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} disabled={readOnly} />
                  {DOW[i]}요일
                </label>
                {r.enabled ? (
                  <div className="times">
                    <Input type="time" aria-label={`${DOW[i]}요일 출근`} value={r.startTime} onChange={(e) => setRow(i, { startTime: e.target.value })} disabled={readOnly} required />
                    <span>~</span>
                    <Input type="time" aria-label={`${DOW[i]}요일 퇴근`} value={r.endTime} onChange={(e) => setRow(i, { endTime: e.target.value })} disabled={readOnly} required />
                    {r.breaks.map((b, bi) => (
                      <span key={bi} className="times" style={{ gap: 6 }}>
                        <span className="muted">휴게 {bi + 1}</span>
                        <Input type="time" aria-label={`${DOW[i]}요일 휴게 ${bi + 1} 시작`} value={b.start} onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, start: e.target.value } : x)) })} disabled={readOnly} />
                        <span>~</span>
                        <Input type="time" aria-label={`${DOW[i]}요일 휴게 ${bi + 1} 끝`} value={b.end} onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, end: e.target.value } : x)) })} disabled={readOnly} />
                        <Button type="button" size="sm" onClick={() => setRow(i, { breaks: r.breaks.filter((_, k) => k !== bi) })} disabled={readOnly} aria-label={`${DOW[i]}요일 휴게 ${bi + 1} 삭제`}>
                          ✕
                        </Button>
                      </span>
                    ))}
                    {!readOnly && r.breaks.length < 2 && (
                      <Button type="button" size="sm" onClick={() => setRow(i, { breaks: [...r.breaks, { start: "13:00", end: "14:00" }] })}>
                        + 휴게
                      </Button>
                    )}
                    {!readOnly && (
                      <Button type="button" size="sm" onClick={() => copyToAll(i)} title="켜진 요일 전부에 이 시간을 복사">
                        전체에 복사
                      </Button>
                    )}
                  </div>
                ) : (
                  <span className="closed">근무 없음</span>
                )}
              </div>
            ))}
          </div>
          {!readOnly && others.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--text-4)", marginBottom: 6 }}>다른 담당자에게도 같은 패턴 적용 (일괄 편집)</legend>
              <div className="chips">
                {others.map((s) => (
                  <label key={s.id} className={also.includes(s.id) ? "chip on" : "chip"}>
                    <input type="checkbox" className="sr-only" checked={also.includes(s.id)} onChange={(e) => setAlso((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {!readOnly && (
            <div className="actions">
              <Button type="submit" variant="primary" loading={busy}>
                {from} 부터 적용
              </Button>
            </div>
          )}
          {view && view.history.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                이전 패턴 이력 {view.history.length}건
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-2)" }}>
                {view.history.map((h) => (
                  <li key={h.id}>
                    {h.effectiveFrom} ~ {h.effectiveTo} · {DOW[h.dayOfWeek]} {h.startTime}–{h.endTime}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </form>
      )}
    </div>
  );
}
