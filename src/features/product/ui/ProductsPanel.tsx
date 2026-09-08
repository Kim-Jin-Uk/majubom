"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { ProductListItem } from "@/features/product/products";
import { apiDelete, apiPatch, apiPut, describeError } from "@/lib/client-api";

const STATUS = { DRAFT: ["초안", "var(--muted-fill)", "var(--text-2)"], ACTIVE: ["공개", "var(--primary-tint)", "var(--primary-dark)"], HIDDEN: ["숨김", "var(--warn-bg)", "var(--warn)"], ARCHIVED: ["보관", "var(--muted-fill)", "var(--text-3)"] } as const;

function shape(p: ProductListItem): string {
  const start = p.startMode === "FIXED" ? "고정 회차" : "자유 시작";
  const dur = p.durationOptions?.length ? `${p.durationOptions.map((n) => (n % 60 === 0 ? `${n / 60}시간` : `${n}분`)).join("·")} 선택` : `${p.durationMin}분`;
  const cap = p.capacityPerSlot > 1 ? `정원 ${p.capacityPerSlot}명` : "1팀";
  return `${start} · ${dur} · ${cap}`;
}

/** 상품 목록 (#31). 등록·수정은 별도 화면(ProductForm), 여기서는 상태·순서·삭제 */
export function ProductsPanel({ initial, isOwner, readOnly, canEdit }: { initial: ProductListItem[]; isOwner: boolean; readOnly: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setItems(initial);
  }
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = isOwner && !readOnly;

  async function setStatus(p: ProductListItem, status: "DRAFT" | "ACTIVE" | "HIDDEN") {
    setBusy(true);
    const r = await apiPatch(`/api/console/products/${p.id}/status`, { status });
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: describeError(r) });
    router.refresh();
  }

  async function remove(p: ProductListItem) {
    if (!confirm(`「${p.name}」 삭제할까요? 예약 이력이 있으면 삭제 대신 보관 처리되고 예약 페이지에서만 사라집니다.`)) return;
    setBusy(true);
    const r = await apiDelete<{ mode: "DELETED" | "ARCHIVED"; futureReservations: number }>(`/api/console/products/${p.id}`);
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: describeError(r) });
    else if (r.data.mode === "DELETED") setMsg({ kind: "ok", text: `「${p.name}」 삭제했어요` });
    else setMsg({ kind: "warn", text: `「${p.name}」 예약 이력이 있어 보관 처리했어요${r.data.futureReservations ? ` (앞으로의 예약 ${r.data.futureReservations}건은 그대로 진행)` : ""}` });
    router.refresh();
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    setBusy(true);
    const r = await apiPut("/api/console/products/reorder", { ids: next.map((x) => x.id) });
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: describeError(r) });
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {items.length === 0 && <Alert kind="info">아직 상품이 없어요. 고객이 실제로 고르는 메뉴입니다 — 첫 상품을 등록하면 공개 조건이 채워져요.</Alert>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((p, i) => {
          const [label, bg, fg] = STATUS[p.status];
          return (
            <div key={p.id} className={p.status === "ACTIVE" ? "prod-card" : "prod-card dim"}>
              <div className="thumb">
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL
                  <img src={p.image} alt="" />
                ) : (
                  "사진 없음"
                )}
              </div>
              <div className="body">
                <b>{p.name}</b>
                <span className="tag" style={{ marginLeft: 8, background: bg, color: fg }}>
                  {label}
                </span>
                <div className="meta">
                  {shape(p)}
                  {p.priceDisplay ? ` · ${p.priceDisplay}` : ""}
                  {p.resources.length ? ` · ${p.resources.map((r) => r.name).join(", ")}` : " · 담당 자원 없음"}
                </div>
              </div>
              <div className="actions">
                {owner && (
                  <>
                    <Button size="sm" type="button" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`${p.name} 위로`}>
                      ↑
                    </Button>
                    <Button size="sm" type="button" onClick={() => move(i, 1)} disabled={busy || i === items.length - 1} aria-label={`${p.name} 아래로`}>
                      ↓
                    </Button>
                  </>
                )}
                {canEdit && (
                  <Link href={`/console/products/${p.id}`} className="btn btn--sm">
                    수정
                  </Link>
                )}
                {owner && (
                  <>
                    <select className="select" style={{ width: 96, height: 34, fontSize: 13 }} value={p.status} onChange={(e) => setStatus(p, e.target.value as "DRAFT" | "ACTIVE" | "HIDDEN")} disabled={busy} aria-label={`${p.name} 노출 상태`}>
                      <option value="DRAFT">초안</option>
                      <option value="ACTIVE">공개</option>
                      <option value="HIDDEN">숨김</option>
                    </select>
                    <Button size="sm" type="button" variant="danger" onClick={() => remove(p)} disabled={busy}>
                      삭제
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {owner && (
        <div className="actions">
          <Link href="/console/products/new" className="btn btn--primary">
            + 상품 등록
          </Link>
        </div>
      )}
    </div>
  );
}
