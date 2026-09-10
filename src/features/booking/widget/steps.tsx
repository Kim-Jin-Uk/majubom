"use client";

import type { BookingWidgetData, WidgetProduct } from "./data";
import { DOW, clock, dayText, dowOfDate, minsText, monthGrid, rangeText } from "./format";
import type { SlotDay } from "./slots-client";
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
        <h2>무엇을 예약할까요?</h2>
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
      <h2>{product.name}</h2>
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

/** 그날 예약할 수 있는 자리가 하나라도 있는가. 없는 날은 회색 + 비활성 (명세 "휴무일·풀부킹일 비활성 회색") */
const openOn = (d: SlotDay | undefined): boolean => (d?.slots.length ?? 0) > 0;

export function StepDate({
  product,
  sel,
  tz,
  today,
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
  lastDate: string;
  month: string;
  monthLabel: string;
  onMonth: (n: -1 | 1) => void;
  days: SlotDay[] | null;
  loading: boolean;
  onChange: OnChange;
}) {
  const { lead, days: cells } = monthGrid(month);
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const prevDisabled = month <= `${today.slice(0, 7)}-01`;
  const nextDisabled = month >= `${lastDate.slice(0, 7)}-01`;

  return (
    <section className="bw-panel">
      <h2>언제 오시겠어요?</h2>
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
        `role="grid"` 는 쓰지 않는다 — 제대로 된 grid 는 row 래핑과 방향키 이동까지 갖춰야 하는데,
        반쪽짜리 롤은 스크린리더에 "표인데 행이 없다" 로 읽혀 안 붙인 것만 못하다.
        버튼마다 `aria-label` 로 날짜와 상태를 읽어 주는 편이 정직하다
      */}
      <div className="bw-cal" aria-busy={loading}>
        {DOW.map((d, i) => (
          <span key={d} className={`bw-cal-dow${i === 0 ? " sun" : i === 6 ? " sat" : ""}`} aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {cells.map((date) => {
          const outOfRange = date < today || date > lastDate;
          // 아직 못 읽었으면 비활성이되 "휴무" 로 보이지는 않게 한다 — 로딩과 마감은 다른 상태다
          const known = days !== null && !outOfRange;
          const open = known && openOn(byDate.get(date));
          const dow = dowOfDate(date);
          return (
            <button
              key={date}
              type="button"
              className={`bw-day${sel.date === date ? " on" : ""}${date === today ? " today" : ""}${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}
              disabled={!open}
              aria-disabled={!open}
              aria-label={`${dayText(date)}${open ? "" : outOfRange ? " 예약 불가" : known ? " 예약 마감" : ""}`}
              onClick={() => onChange({ date })}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      {days !== null && cells.every((d) => d < today || d > lastDate || !openOn(byDate.get(d))) && <p className="bw-hint">이 달에는 예약할 수 있는 날이 없어요. 다른 달을 봐 주세요.</p>}
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
      <h2>{sel.date ? dayText(sel.date) : "시간"}</h2>
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
      <h2>담당자를 고르시겠어요?</h2>
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
