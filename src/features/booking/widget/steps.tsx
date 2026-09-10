"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui";
import type { BookingWidgetData, WidgetProduct } from "./data";
import { DOW, calendarDay, clock, dayText, dowOfDate, minsText, monthGrid, monthWeeks, rangeText } from "./format";
import { isCalendarKey, nextFocus, rovingDate } from "./calendar-keys";
import { dayState, type SlotDay } from "./slots-client";
import { ANY_RESOURCE, durationChoices, effectiveDuration, needsDuration, needsParty, resourcePick, type Selection } from "./state";

/**
 * 위젯 단계별 화면 (#79 · #80 · #81). 화면만 있고 상태는 위(`BookingWidget`)가 주소로 들고 있다.
 *
 * 유형별 3변형은 저장된 값이 아니라 세 스위치에서 나온다(`guessPreset`) — 담당자형은 상품만,
 * 공간형은 이용 시간과 공간을, 수업형은 인원을 1단계에서 받는다.
 */
type OnChange = (patch: Partial<Selection>) => void;

// ─────────────────────────── [1] 상품 · 이용 시간 · 인원 ───────────────────────────

export function StepProduct({ data, sel, product, onChange }: { data: BookingWidgetData; sel: Selection; product: WidgetProduct | null; onChange: OnChange }) {
  if (!product) {
    return (
      <section className="bw-panel">
        <h2 tabIndex={-1}>무엇을 예약할까요?</h2>
        <ul className="bw-products">
          {data.products.map((p) => (
            <li key={p.id}>
              <button type="button" className="bw-product" onClick={() => onChange({ productId: p.id })}>
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL
                  <img src={p.images[0]} alt="" />
                ) : (
                  <span className="ph" aria-hidden="true" />
                )}
                <span className="body">
                  <b>{p.name}</b>
                  <span className="meta">
                    {p.durationOptions?.length ? `${p.durationOptions.map(minsText).join(" / ")} 중 선택` : minsText(p.durationMin)}
                    {p.maxPartySize > 1 ? ` · 최대 ${p.maxPartySize}명` : ""}
                    {p.priceDisplay ? ` · ${p.priceDisplay}` : ""}
                  </span>
                  {p.description && <span className="desc">{p.description}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const pick = resourcePick(product);
  return (
    <section className="bw-panel">
      <h2 tabIndex={-1}>{product.name}</h2>
      <button type="button" className="bw-link" onClick={() => onChange({ productId: null })}>
        다른 상품 고르기
      </button>

      {needsDuration(product) && (
        <fieldset className="bw-field">
          <legend>이용 시간</legend>
          <div className="bw-choices">
            {durationChoices(product).map((d) => (
              <button key={d} type="button" className={`bw-chip${sel.durationMin === d ? " on" : ""}`} aria-pressed={sel.durationMin === d} onClick={() => onChange({ durationMin: d })}>
                {minsText(d)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* maxPartySize = 1 이면 인원 입력을 아예 노출하지 않는다 (명세) */}
      {needsParty(product) && (
        <fieldset className="bw-field">
          <legend>인원</legend>
          <div className="bw-choices">
            {Array.from({ length: product.maxPartySize }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className={`bw-chip${sel.partySize === n ? " on" : ""}`} aria-pressed={sel.partySize === n} onClick={() => onChange({ partySize: n })}>
                {n}명
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* REQUIRED(공간형)는 슬롯 조회의 **입력**이라 여기서 받는다 — 시간 뒤로 미루면 조회가 400 이다 */}
      {pick === "step1" && (
        <fieldset className="bw-field">
          <legend>{product.resources[0]?.type === "SPACE" ? "공간" : "담당자"}</legend>
          <div className="bw-choices">
            {product.resources.map((r) => (
              <button key={r.id} type="button" className={`bw-chip${sel.resourceId === r.id ? " on" : ""}`} aria-pressed={sel.resourceId === r.id} onClick={() => onChange({ resourceId: r.id })}>
                {r.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {needsDuration(product) && sel.durationMin === null && <p className="bw-hint">이용 시간을 골라 주세요</p>}
      {pick === "step1" && !sel.resourceId && <p className="bw-hint">{product.resources[0]?.type === "SPACE" ? "공간" : "담당자"}을 골라 주세요</p>}
    </section>
  );
}

// ─────────────────────────────── [2] 날짜 ───────────────────────────────

export function StepDate({
  product,
  sel,
  tz,
  today,
  firstDate,
  lastDate,
  month,
  monthLabel,
  onMonth,
  days,
  loading,
  onChange,
}: {
  product: WidgetProduct;
  sel: Selection;
  tz: string;
  today: string;
  /** 예약을 받을 수 있는 가장 이른 영업일. 오늘이 아닐 수 있다 — 자정을 넘겨 영업하는 가게의 새벽 (가정 A7) */
  firstDate: string;
  lastDate: string;
  month: string;
  monthLabel: string;
  onMonth: (n: -1 | 1) => void;
  days: SlotDay[] | null;
  loading: boolean;
  onChange: OnChange;
}) {
  const cells = monthGrid(month).days;
  const weeks = monthWeeks(month);
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const prevDisabled = month <= `${firstDate.slice(0, 7)}-01`;
  const nextDisabled = month >= `${lastDate.slice(0, 7)}-01`;
  const bounds = { firstDate, lastDate };

  /**
   * 격자 안에서 탭은 **한 번**만 멈춘다 (roving tabindex). 31개 칸이 전부 탭 정지점이면
   * 키보드로 날짜를 지나 다음 요소까지 가는 데 서른 번을 눌러야 한다.
   * 이동은 방향키가 맡고, 옮긴 칸으로 초점을 직접 옮긴다.
   */
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const roving = focusDate && focusDate.slice(0, 7) === month.slice(0, 7) ? focusDate : rovingDate(month, sel.date, today, bounds);
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // 방향키로 옮겼을 때만 초점을 따라 옮긴다 — 첫 렌더에서 달력이 초점을 낚아채면 안 된다
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${roving}"]`)?.focus();
  }, [roving]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!isCalendarKey(e.key)) return;
    e.preventDefault(); // ↑↓ 로 페이지가 스크롤되면 초점이 화면 밖으로 나간다
    const to = nextFocus(roving, e.key, bounds);
    if (to === roving) return;
    moved.current = true;
    // 달을 넘어가면 그 달을 펼친다 — 안 그러면 초점만 사라진 것처럼 보인다
    if (to.slice(0, 7) !== month.slice(0, 7)) onMonth(to > roving ? 1 : -1);
    setFocusDate(to);
  }

  return (
    <section className="bw-panel">
      <h2 tabIndex={-1}>언제 오시겠어요?</h2>
      <p className="bw-sub">
        {product.name} · {minsText(effectiveDuration(product, sel))}
        {sel.partySize > 1 ? ` · ${sel.partySize}명` : ""}
      </p>

      <div className="bw-cal-nav">
        <button type="button" className="bw-nav" onClick={() => onMonth(-1)} disabled={prevDisabled} aria-label="이전 달">
          ‹
        </button>
        <b aria-live="polite">{monthLabel}</b>
        <button type="button" className="bw-nav" onClick={() => onMonth(1)} disabled={nextDisabled} aria-label="다음 달">
          ›
        </button>
      </div>

      {/*
        이제 제대로 된 grid 다 (#85) — row 래핑 · roving tabindex · 방향키. 반쪽짜리 롤은
        스크린리더에 "표인데 행이 없다" 로 읽혀 안 붙인 것만 못하므로, 셋을 다 갖춘 뒤에 붙였다.
      */}
      <div className="bw-cal" role="grid" aria-label="예약 날짜" aria-busy={loading} onKeyDown={onKeyDown} ref={gridRef}>
        <div className="bw-cal-row" role="row">
          {DOW.map((d, i) => (
            <span key={d} className={`bw-cal-dow${i === 0 ? " sun" : i === 6 ? " sat" : ""}`} role="columnheader" aria-label={`${d}요일`}>
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div className="bw-cal-row" role="row" key={week.find(Boolean) ?? String(week)}>
            {week.map((date, i) => {
              if (!date) return <span key={`b-${i}`} role="gridcell" />;
              const state = dayState(date, { firstDate, lastDate }, days, byDate);
              const open = state === "open";
              const dow = dowOfDate(date);
              return (
                <button
                  key={date}
                  type="button"
                  role="gridcell"
                  data-day={date}
                  className={`bw-day${sel.date === date ? " on" : ""}${date === today ? " today" : ""}${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}
                  /*
                    `disabled` 가 아니라 `aria-disabled` 다 — 못 고르는 날도 방향키로 지나갈 수 있어야
                    "이 주는 통째로 닫혔다" 를 알 수 있다 (APG). 누르면 아무 일도 일어나지 않는다
                  */
                  aria-disabled={!open}
                  aria-selected={sel.date === date}
                  aria-current={date === today ? "date" : undefined}
                  tabIndex={date === roving ? 0 : -1}
                  aria-label={`${dayText(date)}${state === "out" ? " 예약 불가" : state === "closed" ? " 예약 마감" : ""}`}
                  onFocus={() => setFocusDate(date)}
                  onClick={() => open && onChange({ date })}
                >
                  {Number(date.slice(8))}
                </button>
                  );
            })}
          </div>
        ))}
      </div>
      {days !== null && cells.every((d) => dayState(d, { firstDate, lastDate }, days, byDate) !== "open") && <p className="bw-hint">이 달에는 예약할 수 있는 날이 없어요. 다른 달을 봐 주세요.</p>}
      {/* 시간대가 다른 곳에서 열어도 화면의 시각은 가게 시각이다 — 조용히 어긋나면 손님이 한 시간 늦게 온다 */}
      <p className="bw-tz">{tz.replace("_", " ")} 기준</p>
    </section>
  );
}

// ─────────────────────────────── [3] 시간 ───────────────────────────────

const REASON: Record<string, string> = { LEAD_TIME: "마감", FULL: "만석", OUT_OF_WINDOW: "운영 시간 외" };

export function StepTime({ product, sel, tz, day, loading, onChange }: { product: WidgetProduct; sel: Selection; tz: string; day: SlotDay | null; loading: boolean; onChange: OnChange }) {
  const slots = day?.slots ?? [];
  // FIXED(수업형)는 못 고르는 회차도 보여 준다 — 시간표가 통째로 보여야 "다음 회차는 언제" 를 안다
  const excluded = product.startMode === "FIXED" ? (day?.excluded ?? []) : [];
  // 회차는 **시각 하나에 카드 하나**다. 같은 시각에 자원이 여럿이면 API 는 자원마다 한 줄을 주는데
  // 그대로 그리면 "20:00 만석" 이 세 줄로 뜬다. 열린 자리가 있으면 닫힌 쪽은 아예 감추고,
  // 전부 닫혔으면 그중 가장 덜 나쁜 사유 하나만 남긴다 (잔여가 있는 FULL > 나머지)
  const openStarts = new Set(slots.map((s) => s.start));
  const closedByStart = new Map<string, (typeof excluded)[number]>();
  for (const e of excluded) {
    if (openStarts.has(e.start)) continue;
    const prev = closedByStart.get(e.start);
    if (!prev || (e.remaining ?? -1) > (prev.remaining ?? -1)) closedByStart.set(e.start, e);
  }
  const rows = [...slots.map((s) => ({ kind: "open" as const, ...s })), ...[...closedByStart.values()].map((e) => ({ kind: "closed" as const, ...e }))].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <section className="bw-panel">
      <h2 tabIndex={-1}>{sel.date ? dayText(sel.date) : "시간"}</h2>
      <button type="button" className="bw-link" onClick={() => onChange({ date: null })}>
        다른 날짜 고르기
      </button>

      {loading && <p className="bw-hint">불러오는 중…</p>}
      {!loading && rows.length === 0 && <p className="bw-hint">이 날은 예약할 수 있는 시간이 없어요.</p>}

      {product.startMode === "FIXED" ? (
        <ul className="bw-sessions">
          {rows.map((x) => (
            <li key={`${x.start}-${x.kind === "closed" ? x.resourceId : "o"}`}>
              <button
                type="button"
                className={`bw-session${sel.startAt === x.start ? " on" : ""}`}
                disabled={x.kind === "closed"}
                onClick={() => onChange({ startAt: x.start })}
                aria-label={`${clock(x.start, tz)} ${product.name}${x.kind === "open" ? ` 잔여 ${x.remaining}자리` : ` ${REASON[x.reason]}`}`}
              >
                <b>{clock(x.start, tz)}</b>
                <span className="t">{rangeText(x.start, x.end, tz)}</span>
                {x.kind === "open" ? (
                  <span className={`r${x.remaining <= 3 ? " soon" : ""}`}>잔여 {x.remaining}자리</span>
                ) : (
                  <span className="r off">{x.reason === "FULL" && typeof x.remaining === "number" ? `잔여 ${x.remaining}자리` : REASON[x.reason]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bw-times">
          {slots.map((s) => (
            <button key={s.start} type="button" className={`bw-time${sel.startAt === s.start ? " on" : ""}`} onClick={() => onChange({ startAt: s.start })} aria-label={`${clock(s.start, tz)} 시작`}>
              {clock(s.start, tz)}
            </button>
          ))}
        </div>
      )}
      {/* 담당자형·공간형의 "마감 임박" 은 그날 남은 시작 시각이 3개 이하일 때 (명세) */}
      {product.startMode === "FREE" && slots.length > 0 && slots.length <= 3 && <p className="bw-hint">남은 시간이 얼마 없어요</p>}
    </section>
  );
}

// ─────────────────────────────── [4] 담당자 ───────────────────────────────

export function StepResource({ product, sel, tz, day, loading, onChange }: { product: WidgetProduct; sel: Selection; tz: string; day: SlotDay | null; loading: boolean; onChange: OnChange }) {
  // "이 시각 가능한 분" 만 — 그래서 되돌아갈 일이 없다 (명세 단계 순서의 근거)
  const slot = day?.slots.find((s) => s.start === sel.startAt);
  const available = product.resources.filter((r) => slot?.resourceIds?.includes(r.id));

  return (
    <section className="bw-panel">
      <h2 tabIndex={-1}>담당자를 고르시겠어요?</h2>
      <p className="bw-sub">
        {sel.date ? dayText(sel.date) : ""} {sel.startAt ? clock(sel.startAt, tz) : ""}
      </p>
      <button type="button" className="bw-link" onClick={() => onChange({ startAt: null })}>
        다른 시간 고르기
      </button>

      {loading ? (
        <p className="bw-hint">불러오는 중…</p>
      ) : available.length === 0 ? (
        <p className="bw-hint">이 시각에 가능한 담당자를 찾지 못했어요. 다른 시간을 골라 주세요.</p>
      ) : (
        <ul className="bw-staff">
          {/* OPTIONAL 은 "상관없음" 이 기본 선택지다 — 고르지 않은 것과 다르다 */}
          <li>
            <button type="button" className={`bw-staff-card${sel.resourceId === ANY_RESOURCE ? " on" : ""}`} onClick={() => onChange({ resourceId: ANY_RESOURCE })}>
              <b>상관없음</b>
              <span>가게에서 배정해 드려요</span>
            </button>
          </li>
          {available.map((r) => (
            <li key={r.id}>
              <button type="button" className={`bw-staff-card${sel.resourceId === r.id ? " on" : ""}`} onClick={() => onChange({ resourceId: r.id })}>
                <b>{r.name}</b>
                <span>이 시각 예약 가능</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────── [5] 확인 · 요청사항 · 정책 ───────────────────────────

/** 확정 결과 3종 (#84). `taken` 은 "방금 마감" — 처음으로 돌려보내지 않고 인접 시각을 제시한다 */
export type Placed =
  | { kind: "CONFIRMED" | "REQUESTED"; code: string; startAt: string; endAt: string; resourceId: string }
  | { kind: "TAKEN"; alternatives: string[] };

export function StepConfirm({
  product,
  sel,
  tz,
  day,
  policy,
  note,
  onNote,
  signedIn,
  busy,
  error,
  onSubmit,
  onChange,
}: {
  product: WidgetProduct;
  sel: Selection;
  tz: string;
  day: SlotDay | null;
  policy: { cancelDeadlineHours: number; autoConfirm: boolean };
  note: string;
  onNote: (v: string) => void;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onChange: OnChange;
}) {
  const resource = product.resources.find((r) => r.id === sel.resourceId);
  const slot = day?.slots.find((s) => s.start === sel.startAt) ?? null;
  // 주소를 손으로 고쳐 오면 "그 시각에 없는 담당자" 가 실려 올 수 있다. 예약 생성이 어차피 재검증하지만,
  // 여기서 먼저 걸러야 손님이 확인 화면에서 본 이름과 실제 배정이 달라지지 않는다
  const resourceGone = Boolean(resource && slot?.resourceIds && !slot.resourceIds.includes(resource.id));
  const remaining = slot?.remaining;
  const only = slot?.resourceIds?.length === 1 ? product.resources.find((r) => r.id === slot.resourceIds![0]) : undefined;
  const assigned = resource ?? (resourcePick(product) === "none" ? only : undefined);

  return (
    <section className="bw-panel">
      <h2 tabIndex={-1}>맞는지 확인해 주세요</h2>

      <dl className="bw-summary">
        <div>
          <dt>상품</dt>
          <dd>
            {product.name}
            {product.priceDisplay ? ` · ${product.priceDisplay}` : ""}
          </dd>
        </div>
        <div>
          <dt>일시</dt>
          <dd>
            {sel.date ? dayText(sel.date) : ""} {sel.startAt && slot ? rangeText(slot.start, slot.end, tz) : sel.startAt ? clock(sel.startAt, tz) : ""}
          </dd>
        </div>
        <div>
          <dt>이용 시간</dt>
          <dd>{minsText(effectiveDuration(product, sel))}</dd>
        </div>
        {/*
          인원 재확인 — 명세가 [5]에서 한 번 더 보게 한 자리다. 여기서 바로 바꿀 수 있게 두되,
          바꾸면 그 시각이 아직 가능한지 알 수 없으므로 `change` 가 시각을 버리고 날짜 단계로 되돌린다
        */}
        {product.maxPartySize > 1 && (
          <div>
            <dt>인원</dt>
            <dd>
              <span className="bw-party">
                {Array.from({ length: product.maxPartySize }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={`bw-chip bw-chip--sm${sel.partySize === n ? " on" : ""}`} aria-pressed={sel.partySize === n} onClick={() => onChange({ partySize: n })}>
                    {n}명
                  </button>
                ))}
              </span>
            </dd>
          </div>
        )}
        <div>
          <dt>{product.resources[0]?.type === "SPACE" ? "공간" : "담당"}</dt>
          {/*
            수업형(NONE)은 고객이 고르지 않지만 **누가 하는지는 보여 준다** — 손님은 강사를 보고 회차를 고른다
            (명세: 회차 카드에 자원 이름을 텍스트로 표시). AUTO 는 자원 목록 자체가 비어 있어 여기 안 걸린다
          */}
          <dd>{assigned ? assigned.name : sel.resourceId === ANY_RESOURCE ? "상관없음 (가게에서 배정)" : "가게에서 배정"}</dd>
        </div>
      </dl>

      <div className="bw-edit">
        <button type="button" className="bw-link" onClick={() => onChange({ startAt: null })}>
          시간 바꾸기
        </button>
        <button type="button" className="bw-link" onClick={() => onChange({ date: null })}>
          날짜 바꾸기
        </button>
      </div>

      {resourceGone && <Alert kind="warn">고르신 담당자가 이 시각에는 어려워졌어요. 시간이나 담당자를 다시 골라 주세요.</Alert>}
      {typeof remaining === "number" && remaining <= 3 && product.startMode === "FIXED" && <Alert kind="warn">남은 자리가 {remaining}개예요. 서두르시는 게 좋겠어요.</Alert>}

      <label className="bw-field" htmlFor="bw-note">
        <span className="bw-field-label">요청사항 (선택)</span>
        <textarea id="bw-note" className="textarea" maxLength={500} rows={3} value={note} onChange={(e) => onNote(e.target.value)} placeholder="미리 알려 주실 것이 있으면 적어 주세요" />
        <span className="bw-hint">{note.length}/500</span>
      </label>

      {/* 정책 안내 — 확정 방식과 취소 기한. 예약을 누르기 **전에** 보여 준다 */}
      <ul className="bw-policy">
        <li>{policy.autoConfirm ? "예약을 누르면 바로 확정돼요." : "가게가 확인한 뒤 확정돼요. 결과는 알림으로 알려 드려요."}</li>
        <li>{policy.cancelDeadlineHours > 0 ? `이용 ${policy.cancelDeadlineHours}시간 전까지 직접 취소할 수 있어요. 그 뒤에는 가게에 문의해 주세요.` : "이용 직전까지 직접 취소할 수 있어요."}</li>
      </ul>

      {error && <Alert kind="error">{error}</Alert>}

      <button type="button" className="btn btn--primary btn--block" onClick={onSubmit} disabled={busy || resourceGone} aria-busy={busy}>
        {busy ? "처리 중…" : signedIn ? "예약하기" : "로그인하고 예약하기"}
      </button>
      {!signedIn && <p className="bw-hint">고르신 내용은 그대로 두고 로그인 화면으로 갑니다. 돌아오면 여기서 이어져요.</p>}
    </section>
  );
}

// ─────────────────────────────── [7] 완료 3종 ───────────────────────────────

export function StepDone({ product, placed, tz, slug, onPick }: { product: WidgetProduct; placed: Placed; tz: string; slug: string; onPick: (startAt: string) => void }) {
  if (placed.kind === "TAKEN") {
    return (
      <section className="bw-panel">
        <h2 tabIndex={-1}>방금 마감됐어요</h2>
        {/* 처음으로 돌려보내지 않는다 (명세). 고른 조건은 그대로 두고 인접 시각만 다시 제시한다 */}
        <p className="bw-sub">고르신 시각을 조금 전에 다른 분이 가져갔어요. 조건은 그대로 두었으니 가까운 시각으로 바로 옮길 수 있어요.</p>
        {placed.alternatives.length > 0 ? (
          <div className="bw-times">
            {placed.alternatives.map((t) => (
              <button key={t} type="button" className="bw-time" onClick={() => onPick(t)}>
                {clock(t, tz)}
              </button>
            ))}
          </div>
        ) : (
          <p className="bw-hint">이 날에는 대신할 시각이 없어요. 다른 날짜를 골라 주세요.</p>
        )}
      </section>
    );
  }

  const confirmed = placed.kind === "CONFIRMED";
  return (
    <section className="bw-panel bw-done">
      <p className={`bw-done-mark${confirmed ? " ok" : ""}`} aria-hidden="true">
        {confirmed ? "✓" : "…"}
      </p>
      <h2 tabIndex={-1}>{confirmed ? "예약이 확정됐어요" : "예약 요청을 보냈어요"}</h2>
      <p className="bw-sub">{confirmed ? "예약 내용을 메일로 보내 드렸어요." : "가게가 확인하면 알려 드릴게요. 아직 확정된 것은 아니에요."}</p>
      <dl className="bw-summary">
        <div>
          <dt>예약번호</dt>
          <dd>
            <b>{placed.code}</b>
          </dd>
        </div>
        <div>
          <dt>상품</dt>
          <dd>{product.name}</dd>
        </div>
        <div>
          <dt>일시</dt>
          <dd>
            {dayText(calendarDay(placed.startAt, tz))} {rangeText(placed.startAt, placed.endAt, tz)}
          </dd>
        </div>
      </dl>
      <a className="btn btn--block" href={`/@${slug}`}>
        가게 페이지로
      </a>
    </section>
  );
}
