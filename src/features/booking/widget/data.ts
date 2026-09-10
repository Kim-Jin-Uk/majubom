import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, productResources, products, resources } from "@/db/schema";
import { mergePolicy } from "@/features/business/policy";
import { guessPreset, type PresetKey } from "@/features/product/presets";
import { firstBookableDate } from "@/features/booking/slots";
import { loadPublicHome } from "@/features/site/public-home";
import { todayIn } from "@/lib/dates";

/**
 * 예약 위젯의 읽기 계층 (FR-SITE-020, 에픽 #11).
 *
 * **게이트는 새로 만들지 않는다.** 공개 홈이 열려 있을 때만 위젯도 열린다 — `loadPublicHome` 이 그 판정을
 * 이미 한 곳에서 하고 있고(`react.cache()` 로 감싸져 있어 같은 요청에서 두 번 돌지 않는다), 여기에 두 번째
 * 판정을 두면 언젠가 둘이 어긋난다. 어긋나는 쪽이 "홈은 404 인데 예약은 받는다" 이면 최악이다.
 *
 * 슬롯은 여기서 읽지 않는다. 인원·이용 시간·자원에 따라 달라져 캐시가 안 되고(FR-BOOK-010),
 * 손님이 달을 넘길 때마다 바뀐다 — 클라이언트가 `/api/public/products/:id/slots` 를 부른다.
 */

export type WidgetResource = { id: string; name: string; type: "STAFF" | "SPACE" | "SHARED"; capacity: number };

export type WidgetProduct = {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  priceDisplay: string | null;
  startMode: "FREE" | "FIXED";
  durationMin: number;
  durationOptions: number[] | null;
  capacityPerSlot: number;
  maxPartySize: number;
  resourceSelectMode: "REQUIRED" | "OPTIONAL" | "AUTO" | "NONE";
  /** 담당자형 · 공간형 · 수업형 — 저장된 값이 아니라 세 스위치로 판정한다 (`guessPreset`) */
  preset: PresetKey;
  /**
   * 고를 수 있는 자원. `AUTO` 는 **빈 배열**이다 — 배정은 서버가 하고 고객에게는 보이지 않는다
   * (FR-PRD-010, 슬롯 API 가 `resourceIds` 를 지우는 것과 같은 규칙).
   */
  resources: WidgetResource[];
};

export type BookingWidgetData = {
  slug: string;
  businessName: string;
  timezone: string;
  /** 사업장 타임존의 오늘 — 달력의 "오늘" 표시 */
  today: string;
  /**
   * 지금 예약을 받을 수 있는 **가장 이른 영업일**. 보통 오늘이지만, 자정을 넘겨 영업하는 가게에서
   * 새벽에 열면 **어제**다 (가정 A7). 달력 하한을 `today` 로 두면 백엔드만 열려 있고 손님은
   * 그 날짜 칸을 누를 수조차 없다 — 고치려던 상황이 화면에 그대로 남는다.
   */
  firstDate: string;
  policy: { minLeadTimeMin: number; maxAdvanceDays: number; cancelDeadlineHours: number; autoConfirm: boolean };
  products: WidgetProduct[];
};

/**
 * `cache()` 인 이유는 공개 홈과 같다 — `generateMetadata` 와 본문이 각각 부른다.
 * 볼 수 없는 사업장은 `null` 이고, 그 판정은 전부 `loadPublicHome` 에 있다.
 */
export const loadBookingWidget = cache(async (businessId: string): Promise<BookingWidgetData | null> => {
  const home = await loadPublicHome(businessId);
  if (!home) return null;

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      images: products.images,
      priceDisplay: products.priceDisplay,
      startMode: products.startMode,
      durationMin: products.durationMin,
      durationOptions: products.durationOptions,
      capacityPerSlot: products.capacityPerSlot,
      maxPartySize: products.maxPartySize,
      resourceSelectMode: products.resourceSelectMode,
    })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.status, "ACTIVE")))
    .orderBy(asc(products.sortOrder), asc(products.createdAt));
  if (rows.length === 0) return null;

  // 상품 × 자원은 N:M 이라 상품마다 한 번씩 읽으면 N+1 이다. 한 번에 읽고 메모리에서 묶는다
  const links = await db
    .select({ productId: productResources.productId, id: resources.id, name: resources.name, type: resources.type, capacity: resources.capacity })
    .from(productResources)
    .innerJoin(resources, eq(resources.id, productResources.resourceId))
    .where(and(inArray(productResources.productId, rows.map((r) => r.id)), eq(resources.isActive, true)))
    .orderBy(asc(resources.sortOrder), asc(resources.name));
  const byProduct = new Map<string, WidgetResource[]>();
  for (const l of links) {
    const list = byProduct.get(l.productId) ?? [];
    list.push({ id: l.id, name: l.name, type: l.type, capacity: l.capacity });
    byProduct.set(l.productId, list);
  }

  const [biz] = await db.select({ policy: businesses.policy }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const policy = mergePolicy(biz?.policy);

  const list = rows
    .map((p) => ({
      ...p,
      preset: guessPreset({ startMode: p.startMode, durationOptions: p.durationOptions, capacityPerSlot: p.capacityPerSlot }),
      resources: p.resourceSelectMode === "AUTO" ? [] : (byProduct.get(p.id) ?? []),
    }))
    // 활성 자원이 하나도 없는 상품은 예약이 성립하지 않는다 — 슬롯이 영원히 비어 "왜 안 되지" 만 남는다.
    // `AUTO` 는 목록을 지웠으므로 원본으로 판정한다
    .filter((p) => (byProduct.get(p.id) ?? []).length > 0);
  if (list.length === 0) return null;

  return {
    slug: home.slug,
    businessName: home.name,
    timezone: home.timezone,
    today: todayIn(home.timezone),
    firstDate: firstBookableDate({ openingHours: home.openingHours, timezone: home.timezone }, Date.now()),
    policy: { minLeadTimeMin: policy.minLeadTimeMin, maxAdvanceDays: policy.maxAdvanceDays, cancelDeadlineHours: policy.cancelDeadlineHours, autoConfirm: policy.autoConfirm },
    products: list,
  };
});
