import { and, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products } from "@/db/schema";
import { BUSINESS_CATEGORIES } from "@/features/business/policy-defaults";
import { businessIsPublic, productIsBookable } from "./visibility";

/**
 * 공개 상품 검색 (메인 `/`).
 *
 * 사업장 홈(`/@{slug}`)은 주소를 아는 손님만 닿는다. 상호를 모르면 아무것도 찾을 수 없어서
 * 메인을 검색으로 둔다. **로그인 없이 되어야 한다** — 예약할 마음을 먹기 전에 둘러보는 화면이다.
 *
 * 보이는 범위는 공개 홈과 같다(`visibility.ts`). 검색이 더 보여 주면 그게 곧 정보 유출이다 —
 * 심사 중·정지·차단·내려둔 사업장이 상호와 상품명을 내보내게 된다.
 */
export type SearchHit = {
  productId: string;
  productName: string;
  durationMin: number;
  priceDisplay: string | null;
  image: string | null;
  businessName: string;
  slug: string;
  category: string;
  categoryLabel: string;
  address: string;
};

const CATEGORY_LABEL = new Map<string, string>(BUSINESS_CATEGORIES.map(([code, label]) => [code, label]));

/** 한 번에 돌려주는 최대 건수. 1기에는 사업장이 적어 페이지네이션 대신 상한 하나로 둔다 (`LATER.md` L-45) */
export const SEARCH_LIMIT = 60;

export type SearchQuery = { q?: string; category?: string };

/**
 * 검색어는 **상품명·상호·주소**를 함께 본다. 손님은 "네일" 처럼 상품으로도, "봄 네일" 처럼 상호로도,
 * "강남" 처럼 동네로도 찾는다. 카테고리는 코드가 아니라 라벨("네일 · 왁싱")로 고르게 하고 코드로 넘긴다.
 *
 * `ilike` 부분 일치다. 형태소 분석이나 랭킹은 두지 않는다 — 사업장이 열 곳일 때 필요한 것은 정확도가 아니라
 * "있는 게 다 보이는 것" 이고, 전문 검색은 대상이 늘어난 뒤에 붙인다 (L-45).
 */
export async function searchProducts(input: SearchQuery = {}): Promise<SearchHit[]> {
  const term = input.q?.trim();
  const category = input.category?.trim();
  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      durationMin: products.durationMin,
      priceDisplay: products.priceDisplay,
      images: products.images,
      businessName: businesses.name,
      slug: businesses.slug,
      category: businesses.category,
      address: businesses.address,
    })
    .from(products)
    .innerJoin(businesses, sql`${businesses.id} = ${products.businessId}`)
    .where(
      and(
        businessIsPublic,
        productIsBookable,
        category && CATEGORY_LABEL.has(category) ? sql`${businesses.category} = ${category}` : undefined,
        // 빈 검색어는 필터가 아니다 — 전부 보여 준다. 1기에는 그게 디렉터리 역할을 한다
        term ? sql`(${products.name} ilike ${`%${term}%`} or ${businesses.name} ilike ${`%${term}%`} or ${businesses.address} ilike ${`%${term}%`})` : undefined,
      ),
    )
    // 상호 안에서는 사업자가 정한 순서를 지킨다. 사업장 사이는 이름순 — 1기에 랭킹 근거가 없다
    .orderBy(asc(businesses.name), asc(products.sortOrder), desc(products.createdAt))
    .limit(SEARCH_LIMIT);

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    durationMin: r.durationMin,
    priceDisplay: r.priceDisplay,
    // 목록에는 대표 사진 하나만. 없으면 카드가 글자만으로도 읽히게 둔다
    image: Array.isArray(r.images) && r.images.length > 0 ? String(r.images[0]) : null,
    businessName: r.businessName,
    slug: r.slug,
    category: r.category,
    categoryLabel: CATEGORY_LABEL.get(r.category) ?? r.category,
    // 스키마는 nullable 이지만 `businessIsPublic` 이 빈 주소를 이미 걸렀다 — 타입만 좁힌다
    address: r.address ?? "",
  }));
}

/** 검색 화면의 카테고리 칩 — 공개 상품이 하나라도 있는 카테고리만 낸다. 눌러도 빈 화면인 칩을 두지 않는다 */
export async function activeCategories(): Promise<Array<{ code: string; label: string; count: number }>> {
  const rows = await db
    .select({ category: businesses.category, count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(businesses, sql`${businesses.id} = ${products.businessId}`)
    .where(and(businessIsPublic, productIsBookable))
    .groupBy(businesses.category);
  return rows
    .map((r) => ({ code: r.category, label: CATEGORY_LABEL.get(r.category) ?? r.category, count: r.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
