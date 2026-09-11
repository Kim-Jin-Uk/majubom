import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { activeCategories, searchProducts, SEARCH_LIMIT } from "@/features/search/search";
import { SearchPanel } from "@/features/search/ui/SearchPanel";

export const metadata = {
  title: "마주,봄 — 예약",
  description: "동네 가게의 예약을 한자리에서. 상품을 찾아 바로 예약하세요.",
};

/**
 * 메인 = 상품 검색 (로그인 없이 된다).
 *
 * 전에는 로그인 화면이었다. 사업장 홈(`/@{slug}`)은 주소를 아는 손님만 닿으므로 상호를 모르면
 * 아무것도 찾을 수 없었고, 서비스에 처음 온 사람이 보는 것이 로그인 폼이었다.
 * 로그인은 헤더로 옮겼다 — 둘러보는 것이 먼저다.
 *
 * `searchParams` 로 검색 상태를 받으므로 요청마다 다르게 렌더된다(정적 캐시 대상이 아니다).
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : undefined;
  };
  const q = one("q");
  const category = one("category");
  const [hits, categories] = await Promise.all([searchProducts({ q, category }), activeCategories()]);

  return (
    <>
      <AppHeader />
      <main className="search-main">
        <h1 className="search-title">무엇을 예약할까요?</h1>
        {/* useSearchParams 를 쓰는 클라이언트 컴포넌트라 경계가 필요하다 */}
        <Suspense fallback={null}>
          {/* key 가 검색 상태다 — 주소가 바뀌면 리마운트돼 입력칸이 주소를 따라간다 (SearchPanel 주석) */}
          <SearchPanel key={`${q ?? ""}|${category ?? ""}`} hits={hits} categories={categories} limited={hits.length >= SEARCH_LIMIT} />
        </Suspense>
      </main>
    </>
  );
}
