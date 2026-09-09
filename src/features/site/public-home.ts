import { cache } from "react";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businessSlugHistory, businesses, products, reviews, users } from "@/db/schema";
import { holidaysForRange, upcomingOccurrences } from "@/features/schedule/holidays";
import { addDays } from "@/features/schedule/resolve";
import { todayIn } from "@/lib/dates";
import { isInfoComplete } from "@/features/business/settings";
import { categoryLabel } from "@/features/business/policy-defaults";
import type { OpeningHour } from "@/db/schema";

/**
 * 공개 사업장 홈 (FR-SITE-010, #71) 의 읽기 계층.
 *
 * **빌더 없이도 공개된다.** 승인된 사업장에는 업종별 시작 템플릿이 적용돼 "빌더를 한 번도 열지 않아도
 * 즉시 예약을 받을 수 있다"(기획서 6.x). 그래서 `site_pages` 행이 **없으면 공개**로 본다 —
 * 행이 있고 `is_published = false` 면 사업자가 명시적으로 내린 것이니 그건 따른다.
 *
 * 존재를 알리지 않는 것이 규칙이다: 없는 slug 도, 정지·차단된 사업장도, 아직 조건을 못 갖춘 사업장도
 * 전부 똑같이 `null`(→404) 이다. 상태별로 다른 응답을 주면 slug 를 훑어 사업장 목록을 만들 수 있다.
 */

export type PublicProduct = {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  priceDisplay: string | null;
  durationMin: number;
  durationOptions: number[] | null;
  capacityPerSlot: number;
  maxPartySize: number;
};

export type PublicReviewSummary = {
  count: number;
  average: number | null;
  /** 최신 3건. 작성자는 마스킹된다 (FR-REV-020) */
  recent: Array<{ id: string; rating: number; content: string; author: string; at: Date }>;
};

export type PublicHome = {
  slug: string;
  name: string;
  /** 사람이 읽는 업종 이름. DB 의 `nail` 같은 코드가 아니다 — 화면·메타태그·JSON-LD 가 전부 이걸 쓴다 */
  category: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  addressDetail: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  openingHours: OpeningHour[];
  products: PublicProduct[];
  /**
   * 앞으로 60일 안의 휴무일. 사업장 전체 휴무만 — 담당자 개인 휴무는 손님이 알 필요가 없다.
   * **메모는 싣지 않는다**: 콘솔의 그 칸은 "예: 추석 연휴, 직원 교육" 이라고 안내하는 내부 메모라
   * 손님에게 보이는 줄 모르고 "원장 병원 진료" 같은 것을 적는다.
   */
  closedDays: Array<{ date: string; partial: { start: string; end: string } | null }>;
  reviews: PublicReviewSummary;
};

/** `홍길동` → `홍*동`. 저평점 고객에 대한 보복 여지를 줄인다 (FR-REV-020) */
export function maskName(name: string | null): string {
  const n = (name ?? "").trim();
  if (n.length === 0) return "익명";
  if (n.length === 1) return n;
  if (n.length === 2) return `${n[0]}*`;
  return `${n[0]}${"*".repeat(n.length - 2)}${n[n.length - 1]}`;
}

export type SlugResolution = { kind: "ok"; businessId: string } | { kind: "moved"; slug: string } | { kind: "none" };

/**
 * slug → 사업장. 바뀐 예전 slug 는 현재 slug 로 301 이 되도록 알려 준다 (FR-BIZ-010 — 한 번 쓴 slug 는 영구 예약).
 * 손님이 저장해 둔 링크나 검색 결과가 죽지 않아야 한다.
 */
export const resolveSlug = cache(async (slug: string): Promise<SlugResolution> => {
  const [live] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.slug, slug)).limit(1);
  if (live) return { kind: "ok", businessId: live.id };
  const [old] = await db
    .select({ current: businesses.slug })
    .from(businessSlugHistory)
    .innerJoin(businesses, eq(businesses.id, businessSlugHistory.businessId))
    .where(and(eq(businessSlugHistory.slug, slug), ne(businesses.slug, slug)))
    .limit(1);
  return old ? { kind: "moved", slug: old.current } : { kind: "none" };
});

/**
 * `cache()` 로 감싼 이유: 한 요청에서 `generateMetadata` 와 페이지 본문이 각각 부른다.
 * drizzle 은 fetch 가 아니라 Next 의 요청 단위 중복 제거를 못 타므로, 감싸지 않으면 쿼리가 통째로 두 번 돈다.
 */
export const loadPublicHome = cache(async (businessId: string): Promise<PublicHome | null> => {
  const [b] = await db
    .select({
      slug: businesses.slug,
      name: businesses.name,
      category: businesses.category,
      description: businesses.description,
      phone: businesses.phone,
      address: businesses.address,
      addressDetail: businesses.addressDetail,
      lat: businesses.lat,
      lng: businesses.lng,
      timezone: businesses.timezone,
      openingHours: businesses.openingHours,
      status: businesses.status,
      phoneForGate: businesses.phone,
      activeResources: sql<number>`(select count(*)::int from resources r where r.business_id = businesses.id and r.is_active)`,
      // 행이 없으면 시작 템플릿으로 공개다 (위 주석) — coalesce 의 기본값이 true 인 이유
      published: sql<boolean>`coalesce((select sp.is_published from site_pages sp where sp.business_id = businesses.id limit 1), true)`,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!b) return null;
  // 승인 전·정지·차단, 그리고 사업자가 내린 홈은 전부 같은 답이다.
  // 정보 완성도(`isInfoComplete`)까지 같이 본다 — 콘솔은 이 조건으로 "아직 공개 아님" 이라 말하는데
  // 공개 홈만 따로 열면, 사장님은 비공개인 줄 아는 사이 임시 주소(`b-xxxxxxx`)가 상호와 소개를 내보낸다.
  // 한 번 쓴 slug 는 영구 예약이라 그 임시 주소를 되물릴 수도 없다
  if (b.status !== "APPROVED" || !b.published) return null;
  if (!isInfoComplete({ name: b.name, phone: b.phoneForGate, address: b.address, openingHours: b.openingHours, slug: b.slug })) return null;

  const rows = await db
    .select({ id: products.id, name: products.name, description: products.description, images: products.images, priceDisplay: products.priceDisplay, durationMin: products.durationMin, durationOptions: products.durationOptions, capacityPerSlot: products.capacityPerSlot, maxPartySize: products.maxPartySize })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.status, "ACTIVE")))
    .orderBy(asc(products.sortOrder), asc(products.createdAt));

  // 예약할 것이 없거나 받을 사람이 없으면 페이지를 열지 않는다 — 빈 가게를 색인시키지 않는다
  if (rows.length === 0 || b.activeResources === 0) return null;

  const today = todayIn(b.timezone);
  const hols = await holidaysForRange(businessId, today, addDays(today, 60));
  const closed = hols
    .filter((h) => h.resourceId === null)
    .flatMap((h) => upcomingOccurrences(h, today, 60).map((date) => ({ date, partial: h.isFullDay ? null : h.startTime && h.endTime ? { start: h.startTime, end: h.endTime } : null })))
    .filter((x) => x.date <= addDays(today, 60));
  // 같은 날에 규칙이 둘 겹칠 수 있다(매주 월요일 + 그 월요일의 명절) — 종일 휴무가 부분 휴무를 덮는다.
  // 안 합치면 화면에 같은 날짜가 두 줄로 나오고 React key 도 부딪힌다
  const byDate = new Map<string, { date: string; partial: { start: string; end: string } | null }>();
  for (const c of closed) {
    const prev = byDate.get(c.date);
    if (!prev || (prev.partial !== null && c.partial === null)) byDate.set(c.date, c);
  }
  const closedDays = [...byDate.values()].sort((a, b2) => a.date.localeCompare(b2.date));

  const [agg] = await db
    .select({ count: sql<number>`count(*)::int`, average: sql<number | null>`avg(${reviews.rating})::float` })
    .from(reviews)
    .where(and(eq(reviews.businessId, businessId), eq(reviews.status, "PUBLISHED")));
  const recent = await db
    .select({ id: reviews.id, rating: reviews.rating, content: reviews.content, at: reviews.createdAt, author: users.name })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .where(and(eq(reviews.businessId, businessId), eq(reviews.status, "PUBLISHED")))
    .orderBy(desc(reviews.createdAt))
    .limit(3);

  return {
    slug: b.slug,
    name: b.name,
    category: categoryLabel(b.category),
    description: b.description,
    phone: b.phone,
    address: b.address,
    addressDetail: b.addressDetail,
    lat: b.lat,
    lng: b.lng,
    timezone: b.timezone,
    openingHours: b.openingHours,
    products: rows,
    closedDays,
    reviews: { count: agg?.count ?? 0, average: agg?.average ?? null, recent: recent.map((r) => ({ ...r, author: maskName(r.author) })) },
  };
});

/**
 * 무효화 대상 경로. 손님이 보는 주소는 `/@{slug}` 지만 Next 가 캐시하는 것은 rewrite 뒤의 내부 경로다 —
 * `/@…` 를 지우면 아무것도 안 지워진다.
 */
export async function publicHomePath(businessId: string): Promise<string | null> {
  const [b] = await db.select({ slug: businesses.slug }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return b ? `/site/${b.slug}` : null;
}
