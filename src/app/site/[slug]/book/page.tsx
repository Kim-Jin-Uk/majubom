import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { BookingWidget } from "@/features/booking/widget/BookingWidget";
import { loadBookingWidget, type BookingWidgetData } from "@/features/booking/widget/data";
import { resolveSlug } from "@/features/site/public-home";
import { todayIn } from "@/lib/dates";

/**
 * 예약 위젯 (FR-SITE-020). 손님이 보는 주소는 `/@{slug}/book` 이고 여기는 프록시가 rewrite 해 주는 내부 경로다.
 *
 * 홈(`/site/[slug]`)과 달리 **캐시하지 않는다.** 화면이 선택 상태(주소 쿼리)에 따라 달라지고, 곧 로그인 여부까지
 * 섞인다 — 프록시도 `/@{slug}` 한 장만 공유 캐시에 올린다(`isPublicHome`).
 *
 * 볼 수 없는 사업장은 홈과 **같은 404** 다. 여기만 열리면 정지된 가게가 예약을 받는다.
 */
export const dynamic = "force-dynamic";

async function load(slug: string): Promise<{ data: BookingWidgetData } | { moveTo: string }> {
  const r = await resolveSlug(slug);
  if (r.kind === "none") notFound();
  if (r.kind === "moved") {
    // 옮겨 간 곳이 지금 열려 있을 때만 알려 준다 — 홈과 같은 규칙
    const moved = await resolveSlug(r.slug);
    if (moved.kind !== "ok" || !(await loadBookingWidget(moved.businessId))) notFound();
    return { moveTo: r.slug };
  }
  const data = await loadBookingWidget(r.businessId);
  if (!data) notFound();
  return { data };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolveSlug(slug);
  const data = r.kind === "ok" ? await loadBookingWidget(r.businessId) : null;
  // 위젯은 색인 대상이 아니다 — 손님이 검색으로 도착할 자리는 가게 홈이고, 여기는 그 홈에서 들어오는 화면이다
  return { title: data ? `예약 — ${data.businessName}` : "예약", robots: { index: false, follow: true } };
}

export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const r = await load(slug);
  if ("moveTo" in r) {
    // 주소가 바뀐 가게로 보낼 때 **고른 것을 같이 넘긴다** — 안 넘기면 손님이 처음부터 다시 고른다
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
    permanentRedirect(`/@${r.moveTo}/book${q.size ? `?${q}` : ""}`);
  }
  return (
    // useSearchParams 를 쓰는 클라이언트 컴포넌트는 Suspense 경계가 필요하다
    <Suspense fallback={<main className="bw" />}>
      <BookingWidget data={r.data} today={todayIn(r.data.timezone)} />
    </Suspense>
  );
}
