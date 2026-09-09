import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { loadPublicHome, resolveSlug, type PublicHome } from "@/features/site/public-home";
import { PublicHomeView } from "@/features/site/ui/PublicHome";

/**
 * 공개 사업장 홈. **손님이 보는 주소는 `/@{slug}` 이고, 여기는 그것을 rewrite 로 받는 내부 경로다** (proxy.ts).
 *
 * 최상위에 `app/[handle]` 을 두면 정의되지 않은 모든 최상위 경로를 이 라우트가 삼킨다.
 * 정적 라우트가 우선이라 `/login` 은 멀쩡하지만, 그 뒤로 생기는 모든 경로가 이 파일의 관심사가 되어 버린다 —
 * 실제로 `no-html-link-for-pages` 가 `/console` 을 "내부 페이지" 로 새로 인식할 만큼 넓다. 그래서 내부 경로로 옮겼다.
 * `/site/...` 를 직접 치는 것은 프록시가 404 로 막는다 — 같은 내용이 두 주소로 열리면 색인이 갈린다.
 *
 * `revalidate = 60` 은 Next 의 캐시고, App Hosting 은 Cloud Run 위라 인스턴스마다 그 캐시가 따로다.
 * 실질 캐시 계층은 CDN 이라 `Cache-Control: s-maxage=60` 을 프록시가 실어 준다.
 */
export const revalidate = 60;

/** slug → 공개 홈. 볼 수 없는 것은 전부 같은 404 다 */
async function resolve(slug: string): Promise<{ home: PublicHome } | { moveTo: string } | null> {
  const r = await resolveSlug(slug);
  if (r.kind === "none") return null;
  if (r.kind === "moved") {
    // 옮겨 간 곳이 **지금 열려 있을 때만** 알려 준다. 아니면 404 —
    // 안 그러면 "이 이름은 임자가 있다 + 지금 주소는 이것" 이 정지·차단된 사업장에 대해서도 새고,
    // slug 목록만 훑어 사업장을 찾아낼 수 있다
    const moved = await resolveSlug(r.slug);
    if (moved.kind !== "ok" || !(await loadPublicHome(moved.businessId))) return null;
    return { moveTo: r.slug };
  }
  const home = await loadPublicHome(r.businessId);
  return home ? { home } : null;
}

async function load(slug: string): Promise<PublicHome> {
  const r = await resolve(slug);
  if (!r) notFound();
  // 바뀐 예전 주소는 새 주소로 영구 이동 — 손님이 저장한 링크와 검색 결과가 죽지 않게 (FR-BIZ-010)
  if ("moveTo" in r) permanentRedirect(`/@${r.moveTo}`);
  return r.home;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolve(slug);
  const home = r && "home" in r ? r.home : null;
  if (!home) return {};
  const where = home.address?.split(" ").slice(0, 2).join(" ");
  const title = `${home.name} — ${home.category}${where ? ` · ${where}` : ""}`;
  const description = home.description?.slice(0, 150) ?? `${home.name} 예약. ${home.products.map((p) => p.name).slice(0, 3).join(", ")}`;
  const url = `${base()}/@${home.slug}`;
  // 상품 사진을 미리보기로 쓴다. 없으면 이미지 없는 카드가 낫다 — `summary_large_image` 만 걸어 두면
  // 카카오톡·슬랙에서 큰 빈 상자가 뜬다
  const image = home.products.flatMap((p) => p.images)[0];
  return {
    title,
    description,
    // 절대 URL 로 적는다. 상대 경로는 metadataBase 에 붙는데, 그게 없으면 Next 가 localhost 로 채운다
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", locale: "ko_KR", siteName: home.name, ...(image ? { images: [image] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}

const base = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * `<script>` 안에 넣을 JSON. `JSON.stringify` 는 `<` 를 escape 하지 않으므로 그대로 심으면
 * 사업자가 소개글에 `</script><script>…` 를 써 넣는 것만으로 **손님 브라우저에서 스크립트가 돈다**.
 * 상호·소개·주소는 전부 사업자가 자유롭게 쓰는 값이고, CSP 에 script-src 도 없다.
 */
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** LocalBusiness JSON-LD (#75). 검색 결과에 영업시간·주소·별점이 붙는다 */
export function jsonLd(home: PublicHome, origin: string) {
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: home.name,
    url: `${origin}/@${home.slug}`,
    ...(home.description ? { description: home.description } : {}),
    ...(home.phone ? { telephone: home.phone } : {}),
    ...(home.address ? { address: { "@type": "PostalAddress", streetAddress: [home.address, home.addressDetail].filter(Boolean).join(" "), addressCountry: "KR" } } : {}),
    ...(home.lat !== null && home.lng !== null ? { geo: { "@type": "GeoCoordinates", latitude: home.lat, longitude: home.lng } } : {}),
    // `open === close` 는 24시간 영업이다(영업일 규약: close ≤ open 이면 익일). 그대로 내보내면
    // 검색엔진에 "매일 0분 영업" 으로 읽혀 영업시간이 통째로 틀린다 — schema.org 는 24시간을 00:00~23:59 로 적는다
    openingHoursSpecification: home.openingHours.map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAYS[h.dow], opens: h.open, closes: h.open === h.close ? "23:59" : h.close })),
    ...(home.reviews.count > 0 && home.reviews.average !== null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(home.reviews.average.toFixed(1)), reviewCount: home.reviews.count } } : {}),
  };
}

export default async function PublicHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = await load(slug);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd(home, base())) }} />
      <PublicHomeView home={home} />
    </>
  );
}
