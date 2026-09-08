"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { DayCell, ScheduleGrid as Grid } from "@/features/schedule/calendar";
import type { ConflictingReservation } from "@/features/schedule/holidays";
import { addDays } from "@/features/schedule/resolve";
import { apiDelete, apiPost, describeError, fieldErrors } from "@/lib/client-api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const KIND_TEXT = { OFF: "휴무", MODIFIED: "시간 변경", BLOCK: "차단", EXTRA: "추가 근무" } as const;
const KIND_HINT: Record<keyof typeof KIND_TEXT, string> = {
  OFF: "그날 근무 없음. 잡힌 예약은 그대로 남으니 먼저 처리해 주세요",
  MODIFIED: "그날만 근무 시간을 바꿔요 (패턴 대신 이 구간)",
  BLOCK: "근무 중 일부 시간을 예약 불가로. 개인 사정·교육 등",
  EXTRA: "근무 아닌 날·시간에 추가로 출근. 휴무(OFF)와 함께 두면 이 구간만 근무",
};

function fmtDate(d: string) {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}
function hours(min: number) {
  return min % 60 === 0 ? `${min / 60}시간` : `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

type Draft = { kind: keyof typeof KIND_TEXT; startTime: string; endTime: string; reason: string };

/**
 * 근무표 그리드 (FR-SCH-030, #41). 자원 × 날짜. 셀을 누르면 예외 등록 (OWNER: 전 종류 · MANAGER: 본인 BLOCK).
 * 계산은 서버(getScheduleGrid)가 끝냈다 — 여기서는 그리기와 편집만.
 */
export function ScheduleGrid({ grid, role, weekStart, today, timezone, readOnly }: { grid: Grid; role: "OWNER" | "MANAGER"; weekStart: string; today: string; timezone: string; readOnly: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ resourceId: string; name: string; date: string; cell: DayCell } | null>(null);
  const [draft, setDraftRaw] = useState<Draft>({ kind: "BLOCK", startTime: "13:00", endTime: "14:00", reason: "" });
  const [conflicts, setConflicts] = useState<ConflictingReservation[] | null>(null);
  // 초안이 바뀌면 이전 충돌 확인은 무효 — 새 구간은 다시 검사받아야 한다
  const setDraft = (u: Draft | ((d: Draft) => Draft)) => {
    setDraftRaw(u);
    setConflicts(null);
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isOwner = role === "OWNER";

  const rows = isOwner ? grid.rows : [...grid.rows].sort((a, b) => Number(b.mine) - Number(a.mine));

  function open(resourceId: string, name: string, cell: DayCell, mine: boolean) {
    if (readOnly || (!isOwner && !mine)) return;
    setEditing({ resourceId, name, date: cell.date, cell });
    const start = cell.work[0]?.start ?? "10:00";
    setDraft({ kind: "BLOCK", startTime: start, endTime: addHour(start), reason: "" });
    setErrors({});
    setConflicts(null);
    setMsg(null);
  }
  const fmtWhen = (d: Date | string) => new Date(d).toLocaleString("ko-KR", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function addHour(t: string) {
    const [h, m] = t.split(":").map(Number);
    return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  async function submit(e: FormEvent, confirmConflicts = false) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPost<{ conflicts: ConflictingReservation[] }>("/api/console/work-exceptions", {
      resourceId: editing.resourceId,
      date: editing.date,
      kind: draft.kind,
      startTime: draft.kind === "OFF" ? null : draft.startTime,
      endTime: draft.kind === "OFF" ? null : draft.endTime,
      reason: draft.reason || null,
      confirmConflicts,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "EXCEPTION_CONFLICT") {
        setConflicts((r.data?.reservations as ConflictingReservation[]) ?? []);
        return;
      }
      if (r.error === "BLOCK_HAS_RESERVATIONS") {
        setConflicts((r.data?.reservations as ConflictingReservation[]) ?? []);
        setMsg({ kind: "error", text: "그 시간에 예약이 있어 차단할 수 없어요. 예약을 먼저 처리(이관·취소)해 달라고 사장님께 요청해 주세요." });
        return;
      }
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg({ kind: "error", text: r.error === "NOT_OWN_RESOURCE" ? "본인 근무표에만 등록할 수 있어요" : r.error === "MANAGER_BLOCK_ONLY" ? "매니저는 차단 시간만 등록할 수 있어요. 휴무·시간 변경은 사장님께 요청해 주세요" : describeError(r) });
      return;
    }
    setEditing(null);
    setConflicts(null);
    setMsg({ kind: "ok", text: `${editing.name} · ${fmtDate(editing.date)} 에 「${KIND_TEXT[draft.kind]}」 등록했어요${confirmConflicts ? " — 겹치는 예약은 그대로 남아 있어요" : ""}` });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("이 예외를 지울까요? 그날은 다시 주간 패턴을 따릅니다.")) return;
    setBusy(true);
    const r = await apiDelete(`/api/console/work-exceptions/${id}`);
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: describeError(r) });
    else setEditing(null);
    router.refresh();
  }

  const prev = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);
  const thisWeek = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay());

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
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {rows.length === 0 && (
        <Alert kind="info">
          담당자(STAFF) 자원이 없어요. <Link href="/console/resources">담당자 · 공간</Link>에서 담당자를 등록하면 근무표가 생겨요. 공간·공용 자원은 영업시간을 그대로 따릅니다.
        </Alert>
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
                          <span key={e.id} className={`badge k-${e.kind}`} title={e.reason ?? undefined}>
                            {KIND_TEXT[e.kind]}
                            {e.startTime ? ` ${e.startTime}–${e.endTime}` : ""}
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
            {editing.name} · {fmtDate(editing.date)} ({DOW[new Date(`${editing.date}T00:00:00Z`).getUTCDay()]})
          </h2>
          <p className="sub">
            이날 근무: {editing.cell.work.length ? editing.cell.work.map((w) => `${w.start}–${w.end}`).join(", ") : "없음"}
            {editing.cell.reservations ? ` · 예약 ${editing.cell.reservations}건` : ""}
          </p>
          {editing.cell.exceptions.length > 0 && (
            <div className="chips">
              {editing.cell.exceptions.map((e) => (
                <span key={e.id} className="chip on">
                  {KIND_TEXT[e.kind]}
                  {e.startTime ? ` ${e.startTime}–${e.endTime}` : ""}
                  {e.reason ? ` · ${e.reason}` : ""}
                  {(isOwner || e.kind === "BLOCK") && (
                    <button type="button" className="chip-btn x" aria-label="예외 삭제" onClick={() => remove(e.id)} disabled={busy}>
                      ✕
                    </button>
                  )}
                </span>
              ))}
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
          <div className="radio-cards">
            {(Object.keys(KIND_TEXT) as Array<keyof typeof KIND_TEXT>)
              .filter((k) => isOwner || k === "BLOCK")
              .map((k) => (
                <label key={k} className={draft.kind === k ? "radio-card on" : "radio-card"}>
                  <input type="radio" name="kind" checked={draft.kind === k} onChange={() => setDraft((d) => ({ ...d, kind: k }))} />
                  <span>
                    <b>{KIND_TEXT[k]}</b>
                    <span className="hint">{KIND_HINT[k]}</span>
                  </span>
                </label>
              ))}
          </div>
          {draft.kind !== "OFF" && (
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
                등록
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
