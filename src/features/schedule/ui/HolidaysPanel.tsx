"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { ResourceItem } from "@/features/business/resources";
import type { ConflictingReservation, HolidayItem } from "@/features/schedule/holidays";
import { apiDelete, apiPost, describeError, fieldErrors } from "@/lib/client-api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const TYPE_TEXT = { ONCE: "일회성", WEEKLY: "매주", MONTHLY_DAY: "매월", YEARLY: "매년" } as const;

export function describeHoliday(h: HolidayItem): string {
  const scope = h.resourceId ? `${h.resourceName ?? "자원"} · ` : "";
  const time = h.isFullDay ? "종일" : `${h.startTime}–${h.endTime}`;
  let when: string;
  switch (h.type) {
    case "ONCE":
      when = h.endDate && h.endDate !== h.startDate ? `${h.startDate} ~ ${h.endDate}` : h.startDate;
      break;
    case "WEEKLY":
      when = `매주 ${DOW[h.dayOfWeek ?? 0]}요일`;
      break;
    case "MONTHLY_DAY":
      when = h.isLastDayOfMonth ? "매월 말일" : `매월 ${h.dayOfMonth}일`;
      break;
    case "YEARLY":
      when = `매년 ${h.month ?? Number(h.startDate.slice(5, 7))}월 ${Number(h.startDate.slice(8, 10))}일`;
      break;
  }
  const until = h.type !== "ONCE" && h.repeatUntil ? ` (${h.repeatUntil} 까지)` : "";
  return `${scope}${when}${until} · ${time}`;
}

type Draft = { resourceId: string; type: keyof typeof TYPE_TEXT; startDate: string; endDate: string; dayOfWeek: string; dayOfMonth: string; isLastDayOfMonth: boolean; isFullDay: boolean; startTime: string; endTime: string; repeatUntil: string; memo: string };

/** 휴무일 관리 (FR-SCH-010, #38). 목록 + 등록. 미래 예약 충돌 시 목록을 보이고 "예약은 두고 등록" 만 제공 — 일괄 취소는 예약 콘솔에서 */
export function HolidaysPanel({ initial, resources, today, readOnly, timezone }: { initial: HolidayItem[]; resources: ResourceItem[]; today: string; readOnly: boolean; timezone: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setItems(initial);
  }
  const [d, setD] = useState<Draft>({ resourceId: "", type: "ONCE", startDate: today, endDate: "", dayOfWeek: "1", dayOfMonth: "1", isLastDayOfMonth: false, isFullDay: true, startTime: "14:00", endTime: "16:00", repeatUntil: "", memo: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<ConflictingReservation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
    setConflicts(null);
  };

  async function submit(e: FormEvent, keepReservations = false) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPost<{ conflicts: ConflictingReservation[] }>("/api/console/holidays", {
      resourceId: d.resourceId || null,
      type: d.type,
      startDate: d.startDate,
      endDate: d.type === "ONCE" && d.endDate ? d.endDate : null,
      dayOfWeek: d.type === "WEEKLY" ? Number(d.dayOfWeek) : null,
      dayOfMonth: d.type === "MONTHLY_DAY" && !d.isLastDayOfMonth ? Number(d.dayOfMonth) : null,
      isLastDayOfMonth: d.type === "MONTHLY_DAY" && d.isLastDayOfMonth,
      isFullDay: d.isFullDay,
      startTime: d.isFullDay ? null : d.startTime,
      endTime: d.isFullDay ? null : d.endTime,
      repeatUntil: d.type !== "ONCE" && d.repeatUntil ? d.repeatUntil : null,
      memo: d.memo || null,
      keepReservations,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "HOLIDAY_CONFLICT") {
        setConflicts((r.data?.reservations as ConflictingReservation[]) ?? []);
        return;
      }
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg({ kind: "error", text: describeError(r) });
      return;
    }
    setConflicts(null);
    setMsg({ kind: keepReservations ? "warn" : "ok", text: keepReservations ? "휴무일을 등록했어요. 이미 잡힌 예약은 그대로 진행되고 새 예약만 막혀요." : "휴무일을 등록했어요" });
    setD((x) => ({ ...x, memo: "", endDate: "" }));
    router.refresh();
  }

  async function remove(h: HolidayItem) {
    if (!confirm(`「${describeHoliday(h)}」 휴무를 지울까요?`)) return;
    setBusy(true);
    const r = await apiDelete(`/api/console/holidays/${h.id}`);
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: describeError(r) });
    else setItems((l) => l.filter((x) => x.id !== h.id));
    router.refresh();
  }

  const staffLike = resources.filter((r) => r.isActive);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section className="panel">
        <h2>등록된 휴무</h2>
        {items.length === 0 ? (
          <p className="sub">아직 휴무가 없어요. 정기 휴무(매주 월요일), 연휴, 개인 휴가를 등록하면 그날 예약이 막혀요.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((h) => (
              <li key={h.id} className="res-card">
                <div className="ic" style={{ fontSize: 11 }}>
                  {TYPE_TEXT[h.type]}
                </div>
                <div className="body">
                  <b>{describeHoliday(h)}</b>
                  {h.memo && <div className="meta">{h.memo}</div>}
                </div>
                {!readOnly && (
                  <Button size="sm" type="button" variant="danger" onClick={() => remove(h)} disabled={busy}>
                    삭제
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!readOnly && (
        <form className="panel" onSubmit={(e) => submit(e)}>
          <h2>휴무 등록</h2>
          {conflicts && conflicts.length > 0 && (
            <Alert kind="warn">
              <b>이 휴무에 잡힌 예약 {conflicts.length}건</b>이 있어요:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {conflicts.slice(0, 10).map((c) => (
                  <li key={c.id}>
                    {new Date(c.startAt).toLocaleString("ko-KR", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {c.resourceName} · {c.customerName ?? "고객"} · {c.code}
                  </li>
                ))}
                {conflicts.length > 10 && <li>… 외 {conflicts.length - 10}건</li>}
              </ul>
              <div style={{ marginTop: 6 }}>예약을 두고 등록하면 그 예약들은 그대로 진행돼요. 일괄 취소·고객 안내는 다음 단계(예약 콘솔)에서 할 수 있어요.</div>
            </Alert>
          )}
          <div className="radio-cards" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {(Object.keys(TYPE_TEXT) as Array<keyof typeof TYPE_TEXT>).map((t) => (
              <label key={t} className={d.type === t ? "radio-card on" : "radio-card"}>
                <input type="radio" name="htype" checked={d.type === t} onChange={() => set("type", t)} />
                <span>
                  <b>{TYPE_TEXT[t]}</b>
                  <span className="hint">{t === "ONCE" ? "연휴·휴가 등 특정 기간" : t === "WEEKLY" ? "정기 휴무 요일" : t === "MONTHLY_DAY" ? "매월 같은 날" : "명절·기념일"}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid-2">
            <Field label="적용 범위" htmlFor="h-scope">
              <select id="h-scope" className="select" value={d.resourceId} onChange={(e) => set("resourceId", e.target.value)}>
                <option value="">사업장 전체</option>
                {staffLike.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} 만
                  </option>
                ))}
              </select>
            </Field>
            <Field label={d.type === "ONCE" ? "시작일" : d.type === "YEARLY" ? "날짜 (월·일만 사용)" : "적용 시작일"} htmlFor="h-start" error={errors.startDate}>
              <Input id="h-start" type="date" required value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            {d.type === "ONCE" && (
              <Field label="종료일 (선택)" htmlFor="h-end" error={errors.endDate} hint="비우면 하루">
                <Input id="h-end" type="date" value={d.endDate} onChange={(e) => set("endDate", e.target.value)} min={d.startDate} />
              </Field>
            )}
            {d.type === "WEEKLY" && (
              <Field label="요일" htmlFor="h-dow" error={errors.dayOfWeek}>
                <select id="h-dow" className="select" value={d.dayOfWeek} onChange={(e) => set("dayOfWeek", e.target.value)}>
                  {DOW.map((n, i) => (
                    <option key={i} value={i}>
                      {n}요일
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {d.type === "MONTHLY_DAY" && (
              <Field label="날짜" htmlFor="h-dom" error={errors.dayOfMonth}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Input id="h-dom" type="number" min={1} max={31} value={d.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} disabled={d.isLastDayOfMonth} style={{ width: 100 }} />
                  <label className="check">
                    <input type="checkbox" checked={d.isLastDayOfMonth} onChange={(e) => set("isLastDayOfMonth", e.target.checked)} />
                    매월 말일
                  </label>
                </div>
              </Field>
            )}
            {d.type !== "ONCE" && (
              <Field label="반복 종료일 (선택)" htmlFor="h-until" error={errors.repeatUntil} hint="비우면 계속">
                <Input id="h-until" type="date" value={d.repeatUntil} onChange={(e) => set("repeatUntil", e.target.value)} min={d.startDate} />
              </Field>
            )}
          </div>
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={!d.isFullDay} onChange={(e) => set("isFullDay", !e.target.checked)} />
              부분 휴무 (시간 구간만)
            </label>
          </div>
          {!d.isFullDay && (
            <div className="grid-2">
              <Field label="시작" htmlFor="h-st" error={errors.startTime}>
                <Input id="h-st" type="time" required value={d.startTime} onChange={(e) => set("startTime", e.target.value)} />
              </Field>
              <Field label="끝" htmlFor="h-et" error={errors.endTime}>
                <Input id="h-et" type="time" required value={d.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="메모 (선택)" htmlFor="h-memo" error={errors.memo} hint="예: 추석 연휴, 직원 교육">
            <Input id="h-memo" maxLength={100} value={d.memo} onChange={(e) => set("memo", e.target.value)} />
          </Field>
          <div className="actions">
            {conflicts && conflicts.length > 0 ? (
              <Button type="button" variant="danger" loading={busy} onClick={(e) => submit(e as unknown as FormEvent, true)}>
                예약은 두고 등록
              </Button>
            ) : (
              <Button type="submit" variant="primary" loading={busy}>
                휴무 등록
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
