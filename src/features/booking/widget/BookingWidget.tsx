"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui";
import { addDays } from "@/features/schedule/resolve";
import type { BookingWidgetData, WidgetProduct } from "./data";
import { clock, dayText, minsText, monthGrid, monthOf, monthTitle, shiftMonth } from "./format";
import { fetchSlots, slotsUrl, windowFor, type SlotDay } from "./slots-client";
import { StepDate, StepProduct, StepResource, StepTime } from "./steps";
import { change, readSelection, resourcePick, selectionQuery, stepOf, type Selection, type Step } from "./state";

/**
 * 예약 위젯 (FR-SITE-020, 에픽 #11). 지금 있는 것은 [1]~[4] — 확인·로그인·완료는 다음 조각이다.
 *
 * **선택은 전부 주소에 있다.** 컴포넌트 상태로 들고 있으면 뒤로가기가 위젯을 통째로 닫고(#85),
 * 카카오 로그인처럼 앱을 다녀오면 사라진다. 단계도 저장하지 않고 선택에서 유도한다(`stepOf`).
 *
 * 슬롯은 **달 단위로 한 번** 읽는다. 날짜 칸을 하나씩 물으면 한 달에 서른 번이고,
 * 시간 격자는 이미 읽은 그 달의 데이터에서 꺼내 쓴다 — 3단계에 요청이 없다.
 */
const LABELS: Record<Step, string> = { 1: "상품", 2: "날짜", 3: "시간", 4: "담당자", 5: "확인" };

export function BookingWidget({ data, today }: { data: BookingWidgetData; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const sel = useMemo(() => readSelection(params, data.products), [params, data.products]);
  const product = useMemo(() => data.products.find((p) => p.id === sel.productId) ?? null, [data.products, sel.productId]);
  const step = stepOf(sel, product);

  // 보고 있는 달은 **유도한다** — 손님이 달을 넘겼을 때만 그 값이 이긴다.
  // 상태로 들고 effect 로 맞추면 선택과 달이 어긋난 프레임이 한 번 생긴다
  const [browsing, setBrowsing] = useState<string | null>(null);
  const month = browsing ?? monthOf(sel.date ?? today);

  // 1단계에서는 아직 조회 조건(이용 시간·인원·공간)이 안 정해졌다 — 그때 부르면 엉뚱한 슬롯을 읽는다
  const range = product && step >= 2 ? windowFor(month, today, data.policy.maxAdvanceDays, monthGrid(month).days.length) : null;
  const url = product && range ? slotsUrl(product, sel, range.from, range.to) : null;
  const [retry, setRetry] = useState(0);
  const key = url === null ? null : `${url}#${retry}`;

  /**
   * 응답에 **어떤 요청의 것인지**를 같이 담는다. 그래야 달을 넘긴 직후 옛 달의 슬롯이 새 달 격자에
   * 잠깐 칠해지지 않는다. 로딩도 따로 두지 않고 "아직 이 키의 응답이 아니다" 로 유도한다 —
   * setState 를 effect 본문에서 하지 않으니 계단식 렌더도 없다.
   */
  const [got, setGot] = useState<{ key: string; days: SlotDay[] | null; error: string | null }>({ key: "", days: null, error: null });
  useEffect(() => {
    if (!key || !url) return;
    const ac = new AbortController();
    fetchSlots(url, ac.signal).then((r) => {
      if (ac.signal.aborted) return; // 우리가 버린 요청은 오류가 아니다
      setGot("error" in r ? { key, days: null, error: r.error } : { key, days: r.days, error: null });
    });
    return () => ac.abort();
  }, [key, url]);

  const fresh = key !== null && got.key === key;
  const days = fresh ? got.days : null;
  const loadError = fresh ? got.error : null;
  const loading = key !== null && !fresh;

  const apply = (patch: Partial<Selection>) => {
    const next = change(sel, patch, product);
    const nextProduct = data.products.find((p) => p.id === next.productId) ?? null;
    const q = selectionQuery(next, nextProduct);
    const href = q ? `${pathname}?${q}` : pathname;
    // **단계가 바뀔 때만** 방문 기록을 남긴다 (#85). 칩 하나 누를 때마다 쌓으면 뒤로가기 다섯 번이
    // 1단계 안에서만 왔다 갔다 하고, 손님은 위젯을 벗어나지 못한다
    const opts = { scroll: false } as const;
    if (stepOf(next, nextProduct) === step) router.replace(href, opts);
    else router.push(href, opts);
  };

  const dayOf = (date: string): SlotDay | null => days?.find((d) => d.date === date) ?? null;
  const homeHref = `/@${data.slug}`;

  return (
    <main className="bw">
      <header className="bw-top">
        <Link href={homeHref} className="bw-back" aria-label="가게 페이지로">
          ←
        </Link>
        <span className="bw-top-name">{data.businessName}</span>
      </header>

      <ol className="bw-steps" aria-label="예약 단계">
        {([1, 2, 3, 4] as Step[])
          .filter((n) => n !== 4 || (product ? resourcePick(product) === "step4" : true))
          .map((n) => (
            <li key={n} className={n === step ? "now" : n < step ? "done" : undefined} aria-current={n === step ? "step" : undefined}>
              <span className="n">{n}</span>
              {LABELS[n]}
            </li>
          ))}
      </ol>

      {loadError && (
        <Alert kind="error">
          {loadError === "NETWORK" ? "네트워크 연결을 확인해 주세요. " : "예약 가능한 시간을 불러오지 못했어요. "}
          <button type="button" className="bw-link" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </button>
        </Alert>
      )}

      {step === 1 && <StepProduct data={data} sel={sel} product={product} onChange={apply} />}
      {step === 2 && product && (
        <StepDate
          product={product}
          sel={sel}
          tz={data.timezone}
          today={today}
          lastDate={addDays(today, data.policy.maxAdvanceDays)}
          month={month}
          onMonth={(n) => setBrowsing(shiftMonth(month, n))}
          monthLabel={monthTitle(month)}
          days={days}
          loading={loading}
          onChange={apply}
        />
      )}
      {step === 3 && product && <StepTime product={product} sel={sel} tz={data.timezone} day={dayOf(sel.date!)} loading={loading} onChange={apply} />}
      {step === 4 && product && <StepResource product={product} sel={sel} tz={data.timezone} day={dayOf(sel.date!)} loading={loading} onChange={apply} />}
      {step === 5 && product && (
        <section className="bw-panel">
          <h2>확인</h2>
          {/* 확인 · 로그인 · 완료는 #82~#84 다. 여기서 멈추는 대신 지금까지 고른 것을 보여 준다 */}
          <Alert kind="info">확인 화면은 곧 열립니다. 지금은 여기까지 고를 수 있어요.</Alert>
          <ProductSummary product={product} sel={sel} tz={data.timezone} />
        </section>
      )}
    </main>
  );
}

function ProductSummary({ product, sel, tz }: { product: WidgetProduct; sel: Selection; tz: string }) {
  const resource = product.resources.find((r) => r.id === sel.resourceId);
  return (
    <dl className="bw-summary">
      <div>
        <dt>상품</dt>
        <dd>{product.name}</dd>
      </div>
      <div>
        <dt>일시</dt>
        <dd>
          {sel.date ? dayText(sel.date) : ""} {sel.startAt ? clock(sel.startAt, tz) : ""}
        </dd>
      </div>
      <div>
        <dt>이용 시간</dt>
        <dd>{minsText(sel.durationMin ?? product.durationMin)}</dd>
      </div>
      {sel.partySize > 1 && (
        <div>
          <dt>인원</dt>
          <dd>{sel.partySize}명</dd>
        </div>
      )}
      {resource && (
        <div>
          <dt>담당</dt>
          <dd>{resource.name}</dd>
        </div>
      )}
    </dl>
  );
}
