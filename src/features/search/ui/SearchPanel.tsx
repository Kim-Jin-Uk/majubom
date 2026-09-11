"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import { bookingHref } from "@/features/site/routing";
import type { SearchHit } from "../search";

/**
 * 검색 입력과 결과 목록.
 *
 * **검색 상태는 주소에 둔다** (`?q=`·`?category=`). 위젯과 같은 이유다 — 컴포넌트 상태로 들면
 * 뒤로가기가 검색을 통째로 잃고, 결과를 남에게 링크로 보낼 수도 없다.
 * 입력 중에는 주소를 건드리지 않고(히스토리가 글자마다 쌓인다) 제출할 때 한 번 바꾼다.
 *
 * 주소가 바뀌면(뒤로가기·칩 클릭) 입력칸도 따라가야 하는데, effect 로 되돌리지 않는다 —
 * 렌더 중 setState 는 한 프레임 어긋난 값을 먼저 그린다. 대신 부모가 `key` 를 검색 상태로 주어
 * 리마운트시킨다. 주소가 정본이고 `draft` 는 그 위의 임시 입력이라는 관계가 그대로 드러난다.
 */
export function SearchPanel({
  hits,
  categories,
  limited,
}: {
  hits: SearchHit[];
  categories: Array<{ code: string; label: string; count: number }>;
  limited: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const [draft, setDraft] = useState(q);

  function go(next: { q?: string; category?: string }) {
    const sp = new URLSearchParams();
    const nq = next.q ?? q;
    const nc = next.category ?? category;
    if (nq.trim()) sp.set("q", nq.trim());
    if (nc) sp.set("category", nc);
    const s = sp.toString();
    router.push(s ? `/?${s}` : "/");
  }

  return (
    <>
      <form
        className="search-bar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: draft });
        }}
        role="search"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="상품·가게 이름이나 동네로 검색"
          aria-label="검색어"
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="primary">
          검색
        </Button>
      </form>

      {categories.length > 0 && (
        <div className="search-chips" role="group" aria-label="업종">
          <button type="button" className={`chip${category ? "" : " on"}`} onClick={() => go({ category: "" })} aria-pressed={!category}>
            전체
          </button>
          {categories.map((c) => (
            <button
              type="button"
              key={c.code}
              className={`chip${category === c.code ? " on" : ""}`}
              onClick={() => go({ category: category === c.code ? "" : c.code })}
              aria-pressed={category === c.code}
            >
              {c.label} <span className="muted">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {hits.length === 0 ? (
        <p className="sub search-empty">
          {q || category ? "조건에 맞는 상품이 없어요. 검색어를 줄이거나 업종을 바꿔 보세요." : "아직 공개된 가게가 없어요."}
        </p>
      ) : (
        <>
          <p className="sub search-count">{limited ? `${hits.length}건 이상` : `${hits.length}건`}</p>
          <ul className="search-list">
            {hits.map((h) => (
              <li key={h.productId}>
                {/* 바로 예약 단계로 보낸다 — 검색에서 상품을 고른 손님에게 가게 홈을 한 번 더 거치게 할 이유가 없다 */}
                <Link href={bookingHref(h.slug, h.productId)} className="search-card">
                  <span className="search-card__name">{h.productName}</span>
                  <span className="search-card__biz">{h.businessName}</span>
                  <span className="search-card__meta">
                    {h.categoryLabel} · {h.durationMin}분{h.priceDisplay ? ` · ${h.priceDisplay}` : ""}
                  </span>
                  <span className="search-card__addr muted">{h.address}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
