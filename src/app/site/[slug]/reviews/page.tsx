import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { optionalUser } from "@/features/auth/guards";
import { loadPublicReviews } from "@/features/review/reviews";
import { Stars } from "@/features/review/ui/StarRating";
import { PublicReviewList } from "@/features/review/ui/PublicReviewList";
import { loadPublicHome, resolveSlug, type PublicHome } from "@/features/site/public-home";
import { SiteTopBar } from "@/features/site/ui/SiteTopBar";
import { reviewsHref } from "@/features/site/routing";

/**
 * 공개 리뷰 목록 (FR-REV-020, #93). 손님이 보는 주소는 `/@{slug}/reviews`.
 *
 * 볼 수 없는 사업장은 홈과 **같은 404** 다 — 여기만 열리면 정지된 가게의 리뷰가 남는다.
 * 별점 필터는 주소에 둔다(`?rating=`): 공유되는 화면이고, 뒤로가기가 필터를 잃으면 안 된다.
 */
export const dynamic = "force-dynamic";

async function load(slug: string): Promise<{ businessId: string; home: PublicHome } | { moveTo: string }> {
  const r = await resolveSlug(slug);
  if (r.kind === "none") notFound();
  if (r.kind === "moved") {
    const moved = await resolveSlug(r.slug);
    if (moved.kind !== "ok" || !(await loadPublicHome(moved.businessId))) notFound();
    return { moveTo: r.slug };
  }
  const home = await loadPublicHome(r.businessId);
  if (!home) notFound();
  return { businessId: r.businessId, home };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolveSlug(slug);
  const home = r.kind === "ok" ? await loadPublicHome(r.businessId) : null;
  // 리뷰 목록은 색인 대상이 아니다 — 검색으로 도착할 자리는 가게 홈이다
  return { title: home ? `리뷰 — ${home.name}` : "리뷰", robots: { index: false, follow: true } };
}

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const r = await load(slug);
  if ("moveTo" in r) permanentRedirect(reviewsHref(r.moveTo));

  const sp = await searchParams;
  const raw = Number(typeof sp.rating === "string" ? sp.rating : "");
  // 모르는 값은 조용히 버린다 — 주소를 잘라 붙였을 때 오류 화면보다 전체 목록이 낫다
  const rating = Number.isInteger(raw) && raw >= 1 && raw <= 5 ? raw : undefined;
  const offset = Math.max(0, Number(typeof sp.offset === "string" ? sp.offset : 0) || 0);

  const page = await loadPublicReviews(r.businessId, { rating, offset });
  const signedIn = (await optionalUser()) !== null;
  const hrefFor = (n?: number, o = 0) => {
    const q = new URLSearchParams();
    if (n) q.set("rating", String(n));
    if (o) q.set("offset", String(o));
    return q.size ? `${reviewsHref(slug)}?${q}` : reviewsHref(slug);
  };

  return (
    <>
      <SiteTopBar slug={slug} name={r.home.name} />
      <main className="search-main">
        <h1 className="search-title">리뷰</h1>

      <section className="review-summary">
        <div className="review-summary__score">
          <b>{page.average === null ? "—" : page.average.toFixed(1)}</b>
          {page.average !== null && <Stars value={Math.round(page.average)} />}
          <span className="sub">{page.total}개</span>
        </div>
        {/* 분포는 **필터를 타지 않는다** — 3점만 골라 본 손님에게 "평균 3.0" 을 보여 주면 가게 평점을 잘못 읽는다 */}
        <ul className="review-hist">
          {page.histogram.map((h) => (
            <li key={h.rating}>
              <Link href={hrefFor(rating === h.rating ? undefined : h.rating)} aria-pressed={rating === h.rating} className={rating === h.rating ? "on" : undefined}>
                <span className="review-hist__label">{h.rating}점</span>
                <span className="review-hist__bar">
                  <i style={{ width: `${page.total ? (h.count / page.total) * 100 : 0}%` }} />
                </span>
                <span className="review-hist__n">{h.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {rating && (
        <p className="sub">
          {rating}점만 보는 중이에요. <Link href={hrefFor()}>전체 보기</Link>
        </p>
      )}

      <PublicReviewList
        signedIn={signedIn}
        items={page.items.map((x) => ({ ...x, at: x.at.toISOString(), reply: x.reply ? { content: x.reply.content, at: x.reply.at.toISOString() } : null }))}
      />

      <div className="actions actions--center" style={{ marginTop: 16 }}>
        {offset > 0 && (
          <Link className="btn" href={hrefFor(rating, Math.max(0, offset - 20))}>
            이전
          </Link>
        )}
        {page.hasMore && (
          <Link className="btn" href={hrefFor(rating, offset + 20)}>
            다음
          </Link>
        )}
        </div>
      </main>
    </>
  );
}
