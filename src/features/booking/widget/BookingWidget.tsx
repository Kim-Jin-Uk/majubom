"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui";
import { hardNavigate } from "@/features/auth/ui/safe-next";
import { apiGet, apiPost, describeError } from "@/lib/client-api";
import { addDays } from "@/features/schedule/resolve";
import type { BookingWidgetData } from "./data";
import { monthGrid, monthOf, monthTitle, shiftMonth } from "./format";
import { fetchSlots, slotsUrl, windowFor, type SlotDay } from "./slots-client";
import { StepConfirm, StepDate, StepDone, StepProduct, StepResource, StepTime, type Placed } from "./steps";
import { ANY_RESOURCE, change, effectiveDuration, readSelection, resourcePick, selectionQuery, stepOf, type Selection, type Step } from "./state";

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

/** 생성 실패 코드 → 손님 문구. 모르는 코드는 공통 문구(`describeError`)로 떨어진다 */
const PLACE_ERROR: Record<string, string> = {
  INVALID_START_TIME: "그 시각은 지금 예약을 받지 않아요. 시간을 다시 골라 주세요",
  LEAD_TIME: "예약은 조금 더 여유 있게 잡아 주세요. 이 시각은 마감됐어요",
  OUT_OF_RANGE: "이 가게가 열어 둔 예약 가능 기간을 벗어났어요",
  DURATION_NOT_ALLOWED: "고르신 이용 시간은 지금 받지 않아요. 다시 골라 주세요",
  PARTY_SIZE_EXCEEDED: "인원이 이 상품의 상한을 넘어요",
  TOO_MANY_ACTIVE: "이 가게에 잡아 두신 예약이 이미 많아요. 하나를 취소한 뒤 다시 시도해 주세요",
  CANCEL_ABUSE: "오늘 취소가 잦아 잠시 예약이 제한됐어요. 내일 다시 시도해 주세요",
  UNAUTHENTICATED: "로그인이 풀렸어요. 다시 로그인해 주세요",
};

export function BookingWidget({ data, signedIn }: { data: BookingWidgetData; signedIn: boolean }) {
  // 날짜 경계는 서버가 정해서 내려보낸다 — 위젯이 다시 계산하면 백엔드 규칙과 갈라진다 (가정 A7)
  const { today, firstDate } = data;
  const lastDate = addDays(today, data.policy.maxAdvanceDays);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const sel = useMemo(() => readSelection(params, data.products), [params, data.products]);
  const product = useMemo(() => data.products.find((p) => p.id === sel.productId) ?? null, [data.products, sel.productId]);
  const step = stepOf(sel, product);

  // 보고 있는 달은 **유도한다** — 손님이 달을 넘겼을 때만 그 값이 이긴다.
  // 상태로 들고 effect 로 맞추면 선택과 달이 어긋난 프레임이 한 번 생긴다
  const [browsing, setBrowsing] = useState<string | null>(null);
  // 기본 달은 **가장 이른 영업일**의 달이다. 새벽에 열었는데 어제가 아직 영업 중이면 그 날짜가 보여야 한다
  const month = browsing ?? monthOf(sel.date ?? firstDate);

  // 1단계에서는 아직 조회 조건(이용 시간·인원·공간)이 안 정해졌다 — 그때 부르면 엉뚱한 슬롯을 읽는다
  const range = product && step >= 2 ? windowFor(month, { firstDate, lastDate }, monthGrid(month).days.length) : null;
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

  // ── [5] 확인 · [6] 로그인 · [7] 완료 ────────────────────────────────────────
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  /**
   * 로그인하고 돌아오면 `?sel=` 만 들고 온다 — 고른 것을 서버에서 되살려 주소에 도로 적는다(#83).
   * 되살린 뒤 `sel` 은 지운다: 남겨 두면 손님이 그 뒤에 바꾼 선택을 이 복원이 매번 덮어쓴다.
   */
  const selectionId = params.get("sel");
  useEffect(() => {
    if (!selectionId) return;
    let alive = true;
    apiGet<{ selection: { productId: string; startAt: string; businessDate: string; partySize: number; durationMin: number | null; resourceId: string | null; customerNote: string | null } }>(
      `/api/public/selections/${selectionId}`,
    ).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        // 만료·가게가 닫힘은 같은 404 다. 되살릴 수 없으면 조용히 처음부터 — 되살린 척하는 것이 더 나쁘다
        router.replace(pathname, { scroll: false });
        return;
      }
      const s = r.data.selection;
      const p = data.products.find((x) => x.id === s.productId) ?? null;
      const restored: Selection = {
        productId: s.productId,
        durationMin: s.durationMin,
        partySize: s.partySize,
        // 4단계에서 고르는 상품인데 자원이 비었으면 "상관없음" 이었다는 뜻이다
        resourceId: s.resourceId ?? (p && resourcePick(p) === "step4" ? ANY_RESOURCE : null),
        // 영업일은 순간에서 되짚을 수 없다 — 20:00~02:00 영업의 새벽 1시는 달력으로 다음 날이다. 그래서 같이 저장해 뒀다
        date: s.businessDate,
        startAt: s.startAt,
      };
      setNote(s.customerNote ?? "");
      const q = selectionQuery(restored, p);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    });
    return () => {
      alive = false;
    };
  }, [selectionId, pathname, router, data.products]);

  async function submit() {
    if (!product || !sel.startAt || !sel.date) return;
    setBusy(true);
    setPlaceError(null);
    const payload = {
      productId: product.id,
      startAt: sel.startAt,
      partySize: sel.partySize,
      durationMin: effectiveDuration(product, sel),
      resourceId: sel.resourceId && sel.resourceId !== ANY_RESOURCE ? sel.resourceId : undefined,
      customerNote: note.trim() || undefined,
    };

    if (!signedIn) {
      // 선택을 서버에 맡기고 로그인으로. sessionStorage 는 카카오 앱을 다녀오면 깨진다 (#83)
      const r = await apiPost<{ selectionId: string }>("/api/public/selections", { ...payload, businessDate: sel.date });
      setBusy(false);
      if (!r.ok) {
        setPlaceError(describeError(r));
        return;
      }
      const back = `${pathname}?sel=${encodeURIComponent(r.data.selectionId)}`;
      // 로그인 왕복은 전체 내비게이션이다 — 새 세션 쿠키로 프록시와 RSC 를 처음부터 다시 태운다
      hardNavigate(`/login?next=${encodeURIComponent(back)}`);
      return;
    }

    const r = await apiPost<{ code: string; status: "REQUESTED" | "CONFIRMED"; startAt: string; endAt: string; resourceId: string }>("/api/reservations", payload);
    setBusy(false);
    if (r.ok) {
      setPlaced({ kind: r.data.status, code: r.data.code, startAt: r.data.startAt, endAt: r.data.endAt, resourceId: r.data.resourceId });
      // 뒤로가기가 확인 화면으로 돌아가 다시 누르는 것을 막는다
      const q = new URLSearchParams(selectionQuery(sel, product));
      q.set("done", r.data.code);
      router.replace(`${pathname}?${q}`, { scroll: false });
      return;
    }
    if (r.status === 409 && r.error === "SLOT_TAKEN") {
      const alts = Array.isArray(r.data?.alternatives) ? (r.data.alternatives as string[]) : [];
      setPlaced({ kind: "TAKEN", alternatives: alts });
      return;
    }
    setPlaceError(PLACE_ERROR[r.error] ?? describeError(r));
  }

  const doneCode = params.get("done");

  return (
    <main className="bw">
      <header className="bw-top">
        <Link href={homeHref} className="bw-back" aria-label="가게 페이지로">
          ←
        </Link>
        <span className="bw-top-name">{data.businessName}</span>
      </header>

      {!placed && !doneCode && (
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
      )}

      {loadError && (
        <Alert kind="error">
          {loadError === "NETWORK" ? "네트워크 연결을 확인해 주세요. " : "예약 가능한 시간을 불러오지 못했어요. "}
          <button type="button" className="bw-link" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </button>
        </Alert>
      )}

      {/* 복원 중에는 1단계가 잠깐 비치지 않게 한다 — 고른 것이 사라진 줄 알고 뒤로 누른다 */}
      {selectionId ? (
        <section className="bw-panel">
          <p className="bw-hint">고르신 내용을 불러오는 중…</p>
        </section>
      ) : (
        <>
      {step === 1 && <StepProduct data={data} sel={sel} product={product} onChange={apply} />}
      {step === 2 && product && (
        <StepDate
          product={product}
          sel={sel}
          tz={data.timezone}
          today={today}
          firstDate={firstDate}
          lastDate={lastDate}
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
      {step === 5 && product && !placed && !doneCode && (
        <StepConfirm
          product={product}
          sel={sel}
          tz={data.timezone}
          day={dayOf(sel.date!)}
          policy={data.policy}
          note={note}
          onNote={setNote}
          signedIn={signedIn}
          busy={busy}
          error={placeError}
          onSubmit={submit}
          onChange={apply}
        />
      )}
      {product && placed && <StepDone product={product} placed={placed} tz={data.timezone} slug={data.slug} onPick={(t) => { setPlaced(null); apply({ startAt: t }); }} />}
      {/*
        새로고침으로 상태가 날아간 뒤의 완료 화면. 예약번호만 주소에 남아 있어 그것만 보여 준다 —
        상세는 마이페이지(에픽 #12)가 오면 그리로 연결한다
      */}
      {product && !placed && doneCode && (
        <section className="bw-panel bw-done">
          <p className="bw-done-mark ok" aria-hidden="true">
            ✓
          </p>
          <h2>예약이 접수됐어요</h2>
          <p className="bw-sub">
            예약번호 <b>{doneCode}</b> · 자세한 내용은 메일로 보내 드렸어요.
          </p>
          <a className="btn btn--block" href={homeHref}>
            가게 페이지로
          </a>
        </section>
      )}
        </>
      )}
    </main>
  );
}
