"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Toast } from "@/components/ui";
import { describeError } from "@/lib/client-api";
import type { ReservationRow } from "../console";
import type { ReservationStatus } from "../slot-types";
import { dayLabel, dayOf, rangeLabel, STATUS_COLOR, STATUS_LABEL, VIA_LABEL } from "./status";

/**
 * 예약 목록 (FR-BOOK-080, #60). 기간·상태·자원·상품·경로·검색어로 거르고 커서로 이어 받는다.
 *
 * 필터는 URL 이 아니라 상태로 둔다 — 목록은 콘솔 안에서만 쓰이고 공유할 주소가 아니다.
 * 대신 첫 페이지는 서버가 그려 준 것을 그대로 쓰고(초기 로딩 없음), 필터가 바뀔 때만 API 를 친다.
 * 날짜는 서버가 사업장 타임존 벽시계로 만들어 보낸다 — 여기서 Date 로 되돌리지 않는다.
 */

const STATUS_ORDER: ReservationStatus[] = ["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELED_BY_USER", "CANCELED_BY_BIZ", "REJECTED", "EXPIRED"];

export type FilterOption = { id: string; name: string };

export function ReservationsPanel({
  initial,
  initialCursor,
  from,
  to,
  resources,
  products,
  initialStatus = [],
}: {
  initial: ReservationRow[];
  initialCursor: string | null;
  from: string;
  to: string;
  resources: FilterOption[];
  products: FilterOption[];
  /** URL 로 들어온 상태 필터 (대시보드의 "승인 대기 보기") — 서버가 이미 이걸로 걸러 그린 첫 페이지와 칩이 어긋나면 안 된다 */
  initialStatus?: ReservationStatus[];
}) {
  /** 입력 중인 값 — 다 채워졌고 순서가 맞을 때만 질의에 반영한다 */
  const [draft, setDraft] = useState({ from, to });
  const [status, setStatus] = useState<ReservationStatus[]>(initialStatus);
  const [resourceId, setResourceId] = useState("");
  const [productId, setProductId] = useState("");
  const [createdVia, setCreatedVia] = useState("");
  const [q, setQ] = useState("");
  /** 지금 화면에 있는 목록 + 그것을 만든 조건 — 조건이 앞서 나가면 커서가 무효라는 것을 이걸로 안다 */
  const [page, setPage] = useState({ items: initial, cursor: initialCursor, key: queryKey(from, to, initialStatus, "", "", "", "") });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 늦게 도착한 예전 질의가 새 결과를 덮지 않게 */
  const seq = useRef(0);

  const range = useMemo(() => (draft.from && draft.to && draft.from <= draft.to ? draft : { from, to }), [draft, from, to]);
  const key = queryKey(range.from, range.to, status, resourceId, productId, createdVia, q.trim());

  const load = useCallback(
    async (append: string | null) => {
      const mine = ++seq.current;
      const asked = queryKey(range.from, range.to, status, resourceId, productId, createdVia, q.trim());
      const p = new URLSearchParams({ from: range.from, to: range.to });
      for (const s of status) p.append("status", s);
      if (resourceId) p.set("resourceId", resourceId);
      if (productId) p.set("productId", productId);
      if (createdVia) p.set("createdVia", createdVia);
      if (q.trim()) p.set("q", q.trim());
      if (append) p.set("cursor", append);
      setBusy(true);
      const res = await fetch(`/api/console/reservations?${p}`, { credentials: "same-origin" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { items?: ReservationRow[]; nextCursor?: string | null; error?: string } | null;
      if (mine !== seq.current) return;
      setBusy(false);
      if (!res || !res.ok || !data?.items) {
        setMsg(describeError({ error: data?.error ?? "NETWORK" }));
        return;
      }
      // 이어 받기는 조건이 그대로일 때만 붙인다 — 그 사이 필터가 바뀌었으면 이 페이지는 버린다
      setPage((prev) => (append ? (prev.key === asked ? { items: [...prev.items, ...data.items!], cursor: data.nextCursor ?? null, key: asked } : prev) : { items: data.items!, cursor: data.nextCursor ?? null, key: asked }));
    },
    [range, status, resourceId, productId, createdVia, q],
  );

  // 필터가 바뀌면 첫 페이지부터 다시. 검색어는 입력이 멈춘 뒤에.
  // "첫 렌더인가" 를 ref 로 세면 StrictMode 의 두 번째 마운트에서 한 번 더 나간다 — 지금 조건이 화면의 조건과 같은지로 판단한다
  useEffect(() => {
    if (key === page.key) return;
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
  }, [key, page.key, load]);

  const toggleStatus = (s: ReservationStatus) => setStatus((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  // 조건이 앞서 나갔으면 커서는 이전 조건의 것이다 — 그걸로 이어 받으면 다른 조건의 행이 섞인다
  const stale = key !== page.key;
  const items = page.items;
  // "내 담당" 강조는 **구분이 될 때만** 켠다 — 자원이 하나뿐인 매장에서는 모든 줄이 칠해져 뜻을 잃는다.
  // 역할로 가르지 않는다: 사장님도 함께 시술하면 자기 건을 찾고 싶다
  const highlightMine = resources.length > 1;
  const days = groupByDay(items);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="rsv-filters">
        <label>
          <span>기간</span>
          {/* 값을 되돌려 넣지 않는다 — 날짜 입력은 세 칸을 다 채우기 전까지 빈 문자열을 보내므로, 옛 값을 다시 씌우면 키보드로 칠 수 없다 */}
          <input type="date" className="input" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        </label>
        <label>
          <span>~</span>
          <input type="date" className="input" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </label>
        <label>
          <span>담당·공간</span>
          <select className="input" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">전체</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>상품</span>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">전체</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>경로</span>
          <select className="input" value={createdVia} onChange={(e) => setCreatedVia(e.target.value)}>
            <option value="">전체</option>
            {Object.entries(VIA_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span>검색</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="고객명 · 이메일 · 예약번호" />
        </label>
      </div>

      <div className="chips" role="group" aria-label="상태 필터">
        {STATUS_ORDER.map((s) => (
          <button key={s} type="button" className={status.includes(s) ? "chip on" : "chip"} aria-pressed={status.includes(s)} onClick={() => toggleStatus(s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
        {status.length > 0 && (
          <button type="button" className="chip-btn x" onClick={() => setStatus([])}>
            초기화
          </button>
        )}
      </div>

      {draft.from && draft.to && draft.from > draft.to && <Alert kind="warn">시작일이 종료일보다 늦어요. 아래 목록은 아직 이전 조건이에요.</Alert>}
      {items.length === 0 && !busy && <Alert kind="info">이 조건에 맞는 예약이 없어요. 기간을 넓히거나 상태 필터를 지워 보세요.</Alert>}

      {days.map(([date, rows]) => (
        <section key={date}>
          <h2 className="rsv-day">{dayLabel(date)}</h2>
          <div className="table-wrap">
            <table className="table rsv-table">
              <thead>
                <tr>
                  <th scope="col">시간</th>
                  <th scope="col">고객</th>
                  <th scope="col">상품</th>
                  <th scope="col">담당·공간</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={highlightMine && r.mine ? "mine" : undefined}>
                    <td>
                      <Link href={`/console/reservations/${r.id}`}>{rangeLabel(r.startAt, r.endAt)}</Link>
                    </td>
                    <td>
                      {r.customerName || "이름 없음"}
                      {r.partySize > 1 && <span className="muted"> · {r.partySize}명</span>}
                      {r.createdVia !== "WEB" && <span className="tag tag--soft">{VIA_LABEL[r.createdVia]}</span>}
                    </td>
                    <td>{r.productName}</td>
                    <td>{r.resourceName}</td>
                    <td>
                      <span className="tag" style={{ background: STATUS_COLOR[r.status][0], color: STATUS_COLOR[r.status][1] }}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {page.cursor && !stale && (
        <Button variant="default" onClick={() => void load(page.cursor)} loading={busy}>
          더 보기
        </Button>
      )}
      {msg && <Toast kind="error" onClose={() => setMsg(null)}>{msg}</Toast>}
    </div>
  );
}

/** 질의를 문자열 하나로 — 상태 배열은 순서가 뜻을 바꾸지 않으므로 정렬해서 넣는다 */
function queryKey(from: string, to: string, status: readonly string[], resourceId: string, productId: string, createdVia: string, q: string): string {
  return JSON.stringify([from, to, [...status].sort(), resourceId, productId, createdVia, q]);
}

/** 시작 날짜로 묶는다 — 목록은 이미 startAt 순으로 온다 */
function groupByDay(items: ReservationRow[]): Array<[string, ReservationRow[]]> {
  const out: Array<[string, ReservationRow[]]> = [];
  for (const r of items) {
    const d = dayOf(r.startAt);
    const last = out[out.length - 1];
    if (last && last[0] === d) last[1].push(r);
    else out.push([d, [r]]);
  }
  return out;
}
