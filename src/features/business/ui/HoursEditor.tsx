"use client";

import { Button, Input } from "@/components/ui";
import type { OpeningHour } from "@/db/schema";

/**
 * 요일별 시간 편집기 — **사업장 영업시간과 상품 시간이 같이 쓴다.**
 *
 * 두 곳에 따로 쓰면 휴게 규칙·자정 넘김 안내·빠른 설정이 한쪽만 고쳐진다.
 * 상태는 부모가 들고, 여기서는 그리기만 한다(제어 컴포넌트).
 */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 편집용 행 — 휴무는 enabled=false. breaks 는 빈 문자열 허용(저장 시 걸러낸다) */
export type HourRow = { enabled: boolean; open: string; close: string; breaks: Array<{ start: string; end: string }> };

export function toRows(hours: OpeningHour[]): HourRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const h = hours.find((x) => x.dow === dow);
    return h ? { enabled: true, open: h.open, close: h.close, breaks: h.breaks ?? [] } : { enabled: false, open: "10:00", close: "20:00", breaks: [] };
  });
}

export function fromRows(rows: HourRow[]): OpeningHour[] {
  return rows
    .map((r, dow) => ({ ...r, dow, breaks: r.breaks.filter((b) => b.start && b.end) }))
    .flatMap((r) => (r.enabled ? [{ dow: r.dow, open: r.open, close: r.close, ...(r.breaks.length ? { breaks: r.breaks } : {}) }] : []));
}

/** 자주 쓰는 값. 프리셋을 누른 뒤에도 요일별로 마저 고칠 수 있다 — 잠그는 것이 아니라 채워 주는 것이다 */
export const PRESET_WEEKDAY = (): HourRow[] => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ enabled: dow >= 1 && dow <= 5, open: "10:00", close: "19:00", breaks: [] }));
export const PRESET_ALLDAY = (): HourRow[] => [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, open: "00:00", close: "00:00", breaks: [] }));

export function HoursEditor({
  rows,
  onChange,
  disabled,
  showTools = true,
  idPrefix = "h",
}: {
  rows: HourRow[];
  onChange: (rows: HourRow[]) => void;
  disabled: boolean;
  showTools?: boolean;
  /** 같은 화면에 편집기가 둘일 때 aria-label 이 겹치지 않게 */
  idPrefix?: string;
}) {
  const setRow = (i: number, patch: Partial<HourRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstEnabled = rows.findIndex((r) => r.enabled);
  /** 그 요일의 시간·휴게를 **켜져 있는 다른 요일**에만 복사한다. 꺼 둔 요일을 켜지 않는다 — 휴무는 사장님이 정한 것이다 */
  const applyToAll = (from: number) =>
    onChange(from < 0 ? rows : rows.map((r) => (r.enabled ? { ...r, open: rows[from].open, close: rows[from].close, breaks: rows[from].breaks.map((b) => ({ ...b })) } : r)));

  return (
    <>
      {/* 한 요일만 채우고 나머지에 같은 값을 넣는 일이 대부분이다 — 일곱 번 입력하게 두지 않는다 */}
      {showTools && !disabled && (
        <div className="hours-tools">
          <span className="muted">빠른 설정</span>
          <Button type="button" size="sm" onClick={() => applyToAll(firstEnabled)} disabled={firstEnabled < 0}>
            켜 둔 요일과 동일하게
          </Button>
          <Button type="button" size="sm" onClick={() => onChange(PRESET_WEEKDAY())}>
            평일 10–19 · 주말 휴무
          </Button>
          <Button type="button" size="sm" onClick={() => onChange(PRESET_ALLDAY())}>
            매일 종일
          </Button>
          <Button type="button" size="sm" onClick={() => onChange(toRows([]))}>
            모두 끄기
          </Button>
        </div>
      )}
      <div className="hours">
        {rows.map((r, i) => (
          <div key={i} className="hours-row">
            <label className="check" style={{ height: 38 }}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} disabled={disabled} />
              {DOW[i]}요일
            </label>
            {r.enabled ? (
              <div className="times">
                <Input type="time" aria-label={`${idPrefix} ${DOW[i]}요일 시작`} value={r.open} onChange={(e) => setRow(i, { open: e.target.value })} disabled={disabled} required />
                <span>~</span>
                <Input type="time" aria-label={`${idPrefix} ${DOW[i]}요일 마감`} value={r.close} onChange={(e) => setRow(i, { close: e.target.value })} disabled={disabled} required />
                {r.breaks.map((b, bi) => (
                  <span key={bi} className="times" style={{ gap: 6 }}>
                    <span className="muted">휴게 {bi + 1}</span>
                    <Input
                      type="time"
                      aria-label={`${idPrefix} ${DOW[i]}요일 휴게 ${bi + 1} 시작`}
                      value={b.start}
                      onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, start: e.target.value } : x)) })}
                      disabled={disabled}
                    />
                    <span>~</span>
                    <Input
                      type="time"
                      aria-label={`${idPrefix} ${DOW[i]}요일 휴게 ${bi + 1} 끝`}
                      value={b.end}
                      onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, end: e.target.value } : x)) })}
                      disabled={disabled}
                    />
                    <Button type="button" size="sm" onClick={() => setRow(i, { breaks: r.breaks.filter((_, k) => k !== bi) })} disabled={disabled} aria-label={`${idPrefix} ${DOW[i]}요일 휴게 ${bi + 1} 삭제`}>
                      ✕
                    </Button>
                  </span>
                ))}
                {r.breaks.length < 2 && (
                  <Button type="button" size="sm" onClick={() => setRow(i, { breaks: [...r.breaks, { start: "13:00", end: "14:00" }] })} disabled={disabled}>
                    + 휴게시간
                  </Button>
                )}
              </div>
            ) : (
              <span className="closed">휴무</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
