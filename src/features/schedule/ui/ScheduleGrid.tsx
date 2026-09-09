"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Toast } from "@/components/ui";
import type { DayCell, ScheduleGrid as Grid } from "@/features/schedule/calendar";
import type { ConflictingReservation } from "@/features/schedule/holidays";
import { addDays } from "@/features/schedule/resolve";
import type { LeaveRequest } from "@/features/schedule/work-exceptions";
import { apiDelete, apiPost, describeError, fieldErrors, type ApiResult } from "@/lib/client-api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const KIND_TEXT = { OFF: "휴무", MODIFIED: "시간 변경", BLOCK: "차단", EXTRA: "추가 근무" } as const;
const KIND_HINT: Record<keyof typeof KIND_TEXT, string> = {
  OFF: "그날 근무 없음. 잡힌 예약은 그대로 남으니 먼저 처리해 주세요",
  MODIFIED: "그날만 근무 시간을 바꿔요 (패턴 대신 이 구간)",
  BLOCK: "근무 중 일부 시간을 예약 불가로. 개인 사정·교육 등",
  EXTRA: "근무 아닌 날·시간에 추가로 출근. 휴무(OFF)와 함께 두면 이 구간만 근무",
};
const STATUS_TEXT = { PENDING: "승인 대기", APPROVED: "", REJECTED: "반려" } as const;

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}
function fmtDow(d: string) {
  return DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
}
function hours(min: number) {
  return min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

type Cell = DayCell["exceptions"][number];
/** 배지·칩 라벨: 승인된 신청은 "휴가", 사장님이 직접 둔 건 종류 이름, 대기·반려는 상태를 앞에 */
function label(e: Pick<Cell, "kind" | "status" | "decidedAt" | "startTime" | "endTime">) {
  // 대기·반려는 신청이고, 승인됐어도 결정 시각이 있으면 신청을 거친 것
  const base = e.status !== "APPROVED" || e.decidedAt ? "휴가" : KIND_TEXT[e.kind];
  const st = e.status === "APPROVED" ? "" : `${STATUS_TEXT[e.status]} · `;
  return `${st}${base}${e.startTime ? ` ${e.startTime}–${e.endTime}` : e.kind === "OFF" && e.status !== "APPROVED" ? " 종일" : ""}`;
}

type Draft = { mode: "DIRECT" | "LEAVE"; kind: keyof typeof KIND_TEXT; allDay: boolean; startTime: string; endTime: string; reason: string };
type Msg = { kind: "ok" | "error" | "warn"; text: string };

/** 오류 코드 → 사람 말. 폼 아래 토스트로 보이므로 한 문장으로 */
function explain(r: ApiResult<unknown> & { ok: false }, kind: keyof typeof KIND_TEXT, isOwner: boolean): string {
  switch (r.error) {
    case "EXCEPTION_EXISTS":
      return isOwner
        ? `이날은 이미 「${KIND_TEXT[(r.data?.kind as keyof typeof KIND_TEXT) ?? kind]}」가 등록돼 있거나 승인 대기 중이에요. 바꾸려면 기존 항목을 지우고 다시 등록해 주세요.`
        : "이날은 이미 종일 휴가가 등록돼 있거나 승인 대기 중이에요. 바꾸려면 기존 신청을 취소하고 다시 신청해 주세요.";
    case "NOT_OWN_RESOURCE":
      return "본인 근무표에만 등록할 수 있어요";
    case "MANAGER_BLOCK_ONLY":
      return "매니저는 차단(바로 적용) 또는 휴가 신청(종일·시간)만 할 수 있어요. 시간 변경·추가 근무는 사장님께 요청해 주세요";
    case "NOT_PENDING":
      return "이미 처리된 신청이에요. 새로 고치면 현재 상태가 보여요";
    default:
      return describeError(r);
  }
}

/**
 * 근무표 그리드 (FR-SCH-030, #41). 자원 × 날짜. 셀을 누르면 예외 등록 (OWNER: 전 종류 바로 적용 · MANAGER: 본인 차단 바로, 휴가는 신청 → 사장님 승인).
 * 계산은 서버(getScheduleGrid)가 끝냈다 — 여기서는 그리기와 편집만. 결과·오류는 토스트로(폼이 아래쪽에 있어 위쪽 Alert 는 안 보인다).
 */
export function ScheduleGrid({ grid, role, weekStart, today, timezone, readOnly }: { grid: Grid; role: "OWNER" | "MANAGER"; weekStart: string; today: string; timezone: string; readOnly: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ resourceId: string; name: string; date: string; cell: DayCell } | null>(null);
  const [draft, setDraftRaw] = useState<Draft>({ mode: "DIRECT", kind: "BLOCK", allDay: true, startTime: "13:00", endTime: "14:00", reason: "" });
  const [conflicts, setConflicts] = useState<ConflictingReservation[] | null>(null);
  // 초안이 바뀌면 이전 충돌 확인은 무효 — 새 구간은 다시 검사받아야 한다
  const setDraft = (u: Draft | ((d: Draft) => Draft)) => {
    setDraftRaw(u);
    setConflicts(null);
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg | null>(null);
  const closeMsg = useCallback(() => setMsg(null), []);
  const [busy, setBusy] = useState(false);
  const isOwner = role === "OWNER";

  const rows = isOwner ? grid.rows : [...grid.rows].sort((a, b) => Number(b.mine) - Number(a.mine));

  function open(resourceId: string, name: string, cell: DayCell, mine: boolean) {
    if (readOnly || (!isOwner && !mine)) return;
    setEditing({ resourceId, name, date: cell.date, cell });
    const start = cell.work[0]?.start ?? "10:00";
    setDraft({ mode: "DIRECT", kind: "BLOCK", allDay: true, startTime: start, endTime: addHour(start), reason: "" });
    setErrors({});
    setConflicts(null);
    setMsg(null);
  }
  const fmtWhen = (d: Date | string) => new Date(d).toLocaleString("ko-KR", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function addHour(t: string) {
    const [h, m] = t.split(":").map(Number);
    return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** 매니저 휴가 신청은 종일 → OFF, 시간 → BLOCK 으로 보낸다 */
  const effectiveKind = (d: Draft): keyof typeof KIND_TEXT => (!isOwner && d.mode === "LEAVE" ? (d.allDay ? "OFF" : "BLOCK") : d.kind);

  async function submit(e: FormEvent, confirmConflicts = false) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setErrors({});
    setMsg(null);
    const kind = effectiveKind(draft);
    const leave = !isOwner && draft.mode === "LEAVE";
    const r = await apiPost<{ status: "PENDING" | "APPROVED"; conflicts: ConflictingReservation[] }>("/api/console/work-exceptions", {
      resourceId: editing.resourceId,
      date: editing.date,
      kind,
      startTime: kind === "OFF" ? null : draft.startTime,
      endTime: kind === "OFF" ? null : draft.endTime,
      reason: draft.reason || null,
      confirmConflicts,
      leave,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "EXCEPTION_CONFLICT") {
        setConflicts((r.data?.reservations as ConflictingReservation[]) ?? []);
        return;
      }
      if (r.error === "BLOCK_HAS_RESERVATIONS") {
        setConflicts((r.data?.reservations as ConflictingReservation[]) ?? []);
        setMsg({ kind: "error", text: "그 시간에 예약이 있어 바로 차단할 수 없어요. 휴가로 신청하면 사장님이 예약을 보고 결정해요." });
        return;
      }
      if (r.issues) {
        setErrors(fieldErrors(r.issues));
        setMsg({ kind: "error", text: r.issues[0]?.message ?? "입력 내용을 확인해 주세요" });
      } else setMsg({ kind: "error", text: explain(r, kind, isOwner) });
      return;
    }
    setEditing(null);
    setConflicts(null);
    const when = `${editing.name} · ${fmtDate(editing.date)}`;
    setMsg(
      r.data.status === "PENDING"
        ? { kind: "ok", text: `${when} 휴가를 신청했어요. 사장님이 승인하면 근무표에 반영돼요.` }
        : { kind: "ok", text: `${when} 에 「${KIND_TEXT[kind]}」 등록했어요${confirmConflicts ? " — 겹치는 예약은 그대로 남아 있어요" : ""}` },
    );
    router.refresh();
  }

  async function remove(x: Pick<Cell, "id" | "status" | "kind">) {
    const q = x.status === "PENDING" ? "이 휴가 신청을 취소할까요?" : x.status === "REJECTED" ? "반려된 신청을 목록에서 지울까요?" : "이 예외를 지울까요? 그날은 다시 주간 패턴을 따릅니다.";
    if (!confirm(q)) return;
    setBusy(true);
    const r = await apiDelete(`/api/console/work-exceptions/${x.id}`);
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: r.error === "NOT_OWN_RESOURCE" ? "승인된 휴무는 사장님만 되돌릴 수 있어요" : describeError(r) });
    else {
      setEditing(null);
      setMsg({ kind: "ok", text: x.status === "PENDING" ? "신청을 취소했어요" : "지웠어요" });
    }
    router.refresh();
  }

  // ── 휴가 신청 승인·반려 (OWNER) ──
  const [deciding, setDeciding] = useState<{ id: string; conflicts: ConflictingReservation[] | null; rejecting: boolean; note: string } | null>(null);
  async function decide(req: LeaveRequest, decision: "APPROVE" | "REJECT", confirmConflicts = false) {
    setBusy(true);
    setMsg(null);
    const r = await apiPost<{ status: string; conflicts: ConflictingReservation[] }>(`/api/console/work-exceptions/${req.id}/decide`, { decision, note: decision === "REJECT" ? deciding?.note || null : null, confirmConflicts });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "EXCEPTION_CONFLICT") {
        setDeciding({ id: req.id, conflicts: (r.data?.reservations as ConflictingReservation[]) ?? [], rejecting: false, note: deciding?.note ?? "" });
        return;
      }
      setMsg({ kind: "error", text: explain(r, req.kind, true) });
      return;
    }
    setDeciding(null);
    const when = `${req.resourceName} · ${fmtDate(req.date)}${req.startTime ? ` ${req.startTime}–${req.endTime}` : " 종일"}`;
    setMsg(decision === "APPROVE" ? { kind: "ok", text: `${when} 휴가를 승인했어요. 근무표에 반영됐어요${confirmConflicts ? " — 겹치는 예약은 그대로 남아 있어요" : ""}` } : { kind: "ok", text: `${when} 휴가 신청을 반려했어요` });
    router.refresh();
  }

  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const thisWeek = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
  const pending = grid.leaveRequests.filter((x) => x.status === "PENDING");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="actions">
        <Link href={`/console/schedule?week=${prev}`} className="btn btn--sm" aria-label="지난 주">
          ‹ 지난 주
        </Link>
        <Link href={`/console/schedule?week=${thisWeek}`} className="btn btn--sm">
          이번 주
        </Link>
        <Link href={`/console/schedule?week=${next}`} className="btn btn--sm" aria-label="다음 주">
          다음 주 ›
        </Link>
        <b style={{ marginLeft: 6 }}>
          {grid.from} ~ {grid.to}
        </b>
        {isOwner && (
          <span className="actions actions--end">
            <Link href="/console/schedule/pattern" className="btn btn--sm">
              주간 패턴 편성
            </Link>
            <Link href="/console/holidays" className="btn btn--sm">
              휴무일
            </Link>
          </span>
        )}
      </div>
      {msg && (
        <Toast kind={msg.kind} onClose={closeMsg}>
          {msg.text}
        </Toast>
      )}
      {rows.length === 0 && (
        <Alert kind="info">
          담당자(STAFF) 자원이 없어요. <Link href="/console/resources">담당자 · 공간</Link>에서 담당자를 등록하면 근무표가 생겨요. 공간·공용 자원은 영업시간을 그대로 따릅니다.
        </Alert>
      )}

      {/* 휴가 신청: OWNER 는 승인 대기, MANAGER 는 내 신청 상태 */}
      {isOwner && pending.length > 0 && (
        <section className="panel" aria-labelledby="leave-h">
          <h2 id="leave-h" style={{ margin: 0, fontSize: 16 }}>
            휴가 신청 승인 대기 {pending.length}건
          </h2>
          <p className="sub">승인하면 그날 근무표에 바로 반영돼요. 그 시간에 잡힌 예약이 있으면 먼저 보여 드려요.</p>
          <div className="leave-list">
            {pending.map((q) => {
              const d = deciding?.id === q.id ? deciding : null;
              return (
                <div key={q.id} className="leave-row">
                  <span className="who">{q.resourceName}</span>
                  <span className="when">
                    {fmtDate(q.date)} ({fmtDow(q.date)}) {q.startTime ? `${q.startTime}–${q.endTime}` : "종일"}
                  </span>
                  <span className="reason">{q.reason ? `사유: ${q.reason}` : <span className="muted">사유 없음</span>}</span>
                  {!readOnly && (
                    <span className="actions">
                      {d?.rejecting ? (
                        <>
                          <Input aria-label="반려 사유" placeholder="반려 사유 (선택, 신청자에게 보여요)" maxLength={200} value={d.note} onChange={(e) => setDeciding({ ...d, note: e.target.value })} style={{ width: 240 }} />
                          <Button size="sm" variant="danger" loading={busy} onClick={() => decide(q, "REJECT")}>
                            반려 확정
                          </Button>
                          <Button size="sm" onClick={() => setDeciding(null)} disabled={busy}>
                            취소
                          </Button>
                        </>
                      ) : d?.conflicts && d.conflicts.length > 0 ? (
                        <>
                          <Button size="sm" variant="danger" loading={busy} onClick={() => decide(q, "APPROVE", true)}>
                            예약은 두고 승인
                          </Button>
                          <Button size="sm" onClick={() => setDeciding(null)} disabled={busy}>
                            취소
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="primary" loading={busy} onClick={() => decide(q, "APPROVE")}>
                            승인
                          </Button>
                          <Button size="sm" onClick={() => setDeciding({ id: q.id, conflicts: null, rejecting: true, note: "" })} disabled={busy}>
                            반려
                          </Button>
                        </>
                      )}
                    </span>
                  )}
                  {d?.conflicts && d.conflicts.length > 0 && (
                    <div style={{ flexBasis: "100%" }}>
                      <Alert kind="warn">
                        <b>이 시간에 잡힌 예약 {d.conflicts.length}건</b>이 있어요:
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {d.conflicts.map((c) => (
                            <li key={c.id}>
                              {fmtWhen(c.startAt)} · {c.customerName ?? "고객"} · {c.code}
                            </li>
                          ))}
                        </ul>
                        <div style={{ marginTop: 6 }}>그대로 승인하면 예약은 남아 있고 그 시간엔 새 예약만 막혀요. 예약 이관·취소는 예약 콘솔에서. 예약을 먼저 정리하려면 반려해 주세요.</div>
                      </Alert>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!isOwner && grid.leaveRequests.length > 0 && (
        <section className="panel" aria-labelledby="my-leave-h">
          <h2 id="my-leave-h" style={{ margin: 0, fontSize: 16 }}>
            내 휴가 신청
          </h2>
          <div className="leave-list">
            {grid.leaveRequests.map((q) => (
              <div key={q.id} className="leave-row">
                <span className={`badge st-${q.status}`} style={{ fontSize: 12, fontWeight: 700, padding: "1px 8px", borderRadius: 999 }}>
                  {STATUS_TEXT[q.status]}
                </span>
                <span className="when">
                  {fmtDate(q.date)} ({fmtDow(q.date)}) {q.startTime ? `${q.startTime}–${q.endTime}` : "종일"}
                </span>
                <span className="reason">
                  {q.reason ? `사유: ${q.reason}` : ""}
                  {q.status === "REJECTED" && q.decisionNote ? ` · 반려 사유: ${q.decisionNote}` : ""}
                </span>
                {!readOnly && (
                  <span className="actions">
                    <Button size="sm" onClick={() => remove(q)} disabled={busy}>
                      {q.status === "PENDING" ? "신청 취소" : "지우기"}
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="table sched">
          <thead>
            <tr>
              <th style={{ minWidth: 120 }}>담당자</th>
              {grid.dayMeta.map((d) => {
                const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
                const short = d.open && d.staffOnDuty === 0 && rows.length > 0;
                return (
                  <th key={d.date} className={[d.date === today ? "today" : "", !d.open ? "closed" : "", short ? "short" : ""].join(" ")} style={{ minWidth: 112 }}>
                    <div>
                      {fmtDate(d.date)} <span className={dow === 0 ? "sun" : dow === 6 ? "sat" : ""}>({DOW[dow]})</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
                      {d.holiday ? `휴무 · ${d.holiday}` : !d.open ? "영업 안 함" : short ? "근무자 없음" : `근무 ${d.staffOnDuty}명`}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.resourceId} className={r.mine ? "mine" : ""}>
                <td>
                  <b>{r.name}</b>
                  {r.mine && <span className="tag" style={{ marginLeft: 6 }}>나</span>}
                  {!r.isActive && <span className="tag" style={{ marginLeft: 6, background: "var(--muted-fill)", color: "var(--text-2)" }}>비활성</span>}
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                    {r.summary.workDays}일 · {hours(r.summary.workMinutes)} · 예약 {r.summary.reservations}건
                  </div>
                </td>
                {r.days.map((c) => {
                  const canEdit = !readOnly && (isOwner || r.mine);
                  const cls = ["cell", c.source === "HOLIDAY_BUSINESS" || c.source === "HOLIDAY_RESOURCE" ? "hol" : "", c.workMinutes === 0 ? "off" : "", canEdit ? "editable" : ""].join(" ");
                  const body = (
                    <>
                      {c.work.length ? c.work.map((w) => <div key={w.start}>{w.start}–{w.end}</div>) : <span className="muted">{c.source === "HOLIDAY_BUSINESS" ? "휴무" : c.source === "HOLIDAY_RESOURCE" ? "개인 휴무" : c.source === "OFF" ? "OFF" : "—"}</span>}
                    </>
                  );
                  return (
                    <td key={c.date} className={cls}>
                      {canEdit ? (
                        <button type="button" className="cell-btn" onClick={() => open(r.resourceId, r.name, c, r.mine)} aria-label={`${r.name} ${fmtDate(c.date)} 예외 등록`}>
                          {body}
                        </button>
                      ) : (
                        body
                      )}
                      <div className="badges">
                        {c.exceptions.map((e) => (
                          <span key={e.id} className={`badge k-${e.kind} st-${e.status}`} title={[e.reason, e.status === "REJECTED" && e.decisionNote ? `반려 사유: ${e.decisionNote}` : null].filter(Boolean).join(" · ") || undefined}>
                            {label(e)}
                          </span>
                        ))}
                        {c.reservations > 0 && <span className="badge rsv">예약 {c.reservations}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <form className="panel" onSubmit={(e) => submit(e)}>
          <h2>
            {editing.name} · {fmtDate(editing.date)} ({fmtDow(editing.date)})
          </h2>
          <p className="sub">
            이날 근무: {editing.cell.work.length ? editing.cell.work.map((w) => `${w.start}–${w.end}`).join(", ") : "없음"}
            {editing.cell.reservations ? ` · 예약 ${editing.cell.reservations}건` : ""}
          </p>
          {editing.cell.exceptions.length > 0 && (
            <div className="chips">
              {editing.cell.exceptions.map((e) => {
                // 매니저는 본인의 차단·대기·반려만 지운다(승인된 휴무는 사장님만)
                const removable = isOwner || e.status !== "APPROVED" || (e.kind === "BLOCK" && !e.decidedAt);
                return (
                  <span key={e.id} className="chip on">
                    {label(e)}
                    {e.reason ? ` · ${e.reason}` : ""}
                    {e.status === "REJECTED" && e.decisionNote ? ` · 반려 사유: ${e.decisionNote}` : ""}
                    {removable && (
                      <button type="button" className="chip-btn x" aria-label={e.status === "PENDING" ? "신청 취소" : "예외 삭제"} onClick={() => remove(e)} disabled={busy}>
                        ✕
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {conflicts && conflicts.length > 0 && (
            <Alert kind="warn">
              <b>이 시간에 잡힌 예약 {conflicts.length}건</b>이 있어요:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {fmtWhen(c.startAt)} · {c.customerName ?? "고객"} · {c.code}
                  </li>
                ))}
              </ul>
              {isOwner && <div style={{ marginTop: 6 }}>그대로 등록하면 예약은 남아 있고, 그 시간엔 새 예약만 막혀요. 예약 이관·취소는 다음 단계(예약 콘솔)에서 할 수 있어요.</div>}
            </Alert>
          )}
          {isOwner ? (
            <div className="radio-cards">
              {(Object.keys(KIND_TEXT) as Array<keyof typeof KIND_TEXT>).map((k) => (
                <label key={k} className={draft.kind === k ? "radio-card on" : "radio-card"}>
                  <input type="radio" name="kind" checked={draft.kind === k} onChange={() => setDraft((d) => ({ ...d, kind: k }))} />
                  <span>
                    <b>{KIND_TEXT[k]}</b>
                    <span className="hint">{KIND_HINT[k]}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="radio-cards">
                <label className={draft.mode === "DIRECT" ? "radio-card on" : "radio-card"}>
                  <input type="radio" name="mode" checked={draft.mode === "DIRECT"} onChange={() => setDraft((d) => ({ ...d, mode: "DIRECT", kind: "BLOCK" }))} />
                  <span>
                    <b>차단 (바로 적용)</b>
                    <span className="hint">근무 중 일부 시간을 예약 불가로. 그 시간에 예약이 있으면 등록되지 않아요</span>
                  </span>
                </label>
                <label className={draft.mode === "LEAVE" ? "radio-card on" : "radio-card"}>
                  <input type="radio" name="mode" checked={draft.mode === "LEAVE"} onChange={() => setDraft((d) => ({ ...d, mode: "LEAVE" }))} />
                  <span>
                    <b>휴가 신청 (사장님 승인 후 적용)</b>
                    <span className="hint">종일 또는 시간 단위. 승인되기 전까지 근무표는 그대로예요</span>
                  </span>
                </label>
              </div>
              {draft.mode === "LEAVE" && (
                <div className="chips" role="radiogroup" aria-label="휴가 범위">
                  <label className={draft.allDay ? "chip on" : "chip"}>
                    <input type="radio" name="allDay" className="sr-only" checked={draft.allDay} onChange={() => setDraft((d) => ({ ...d, allDay: true }))} />
                    종일
                  </label>
                  <label className={!draft.allDay ? "chip on" : "chip"}>
                    <input type="radio" name="allDay" className="sr-only" checked={!draft.allDay} onChange={() => setDraft((d) => ({ ...d, allDay: false }))} />
                    시간 지정
                  </label>
                </div>
              )}
            </>
          )}
          {effectiveKind(draft) !== "OFF" && (
            <div className="grid-2">
              <Field label="시작" htmlFor="x-start" error={errors.startTime}>
                <Input id="x-start" type="time" required value={draft.startTime} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value }))} />
              </Field>
              <Field label="끝" htmlFor="x-end" error={errors.endTime}>
                <Input id="x-end" type="time" required value={draft.endTime} onChange={(e) => setDraft((d) => ({ ...d, endTime: e.target.value }))} />
              </Field>
            </div>
          )}
          <Field label="사유 (선택)" htmlFor="x-reason" error={errors.reason} hint="본인과 사장님만 볼 수 있어요">
            <Input id="x-reason" maxLength={200} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
          </Field>
          <div className="actions">
            {conflicts && conflicts.length > 0 && isOwner ? (
              <Button type="button" variant="danger" loading={busy} onClick={(e) => submit(e as unknown as FormEvent, true)}>
                예약은 두고 등록
              </Button>
            ) : (
              <Button type="submit" variant="primary" loading={busy}>
                {!isOwner && draft.mode === "LEAVE" ? "휴가 신청" : "등록"}
              </Button>
            )}
            <Button type="button" onClick={() => setEditing(null)} disabled={busy}>
              닫기
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
