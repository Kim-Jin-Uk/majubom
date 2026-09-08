import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { productStatusEnum, resourceSelectModeEnum, startModeEnum } from "./enums";
import { resources } from "./resources";

/** Product.fixedStartTimes 요소 — startMode=FIXED 일 때 요일별 시작 시각. */
export type FixedStartTime = { dow: number; times: string[] };

/**
 * Product — 예약 상품 (02 §2.2). 업종별 모델 없이 **세 스위치**의 조합으로 예약 방식을 정한다.
 *   시작 시각: startMode(FREE/FIXED) + slotIntervalMin | fixedStartTimes
 *   이용 시간: durationMin 고정 | durationOptions 고객 선택 (FIXED 에서는 불가)
 *   정원     : capacityPerSlot (연결 자원 capacity 최솟값 이하 — 앱 검증)
 */
export const products = pgTable(
  "products",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    /** URL 배열, 최대 5장 (앱 검증). */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    startMode: startModeEnum("start_mode").notNull(),
    fixedStartTimes: jsonb("fixed_start_times").$type<FixedStartTime[]>(),
    slotIntervalMin: integer("slot_interval_min"),
    durationMin: integer("duration_min").notNull(),
    durationOptions: integer("duration_options").array(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    capacityPerSlot: integer("capacity_per_slot").notNull().default(1),
    maxPartySize: integer("max_party_size").notNull().default(1),
    /** "50,000원", "상담 후 결정" — 표시 전용 문자열 (결제 미연동). */
    priceDisplay: varchar("price_display", { length: 50 }),
    resourceSelectMode: resourceSelectModeEnum("resource_select_mode").notNull(),
    status: productStatusEnum("status").notNull().default("DRAFT"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // 02 §2.2 Product CHECK 3종 그대로
    check(
      "products_start_mode_shape",
      sql`(${t.startMode} = 'FIXED' AND ${t.fixedStartTimes} IS NOT NULL AND ${t.durationOptions} IS NULL) OR (${t.startMode} = 'FREE' AND ${t.slotIntervalMin} IN (10, 15, 20, 30, 60))`,
    ),
    check(
      "products_duration_in_options",
      sql`${t.durationOptions} IS NULL OR ${t.durationMin} = ANY(${t.durationOptions})`,
    ),
    check(
      "products_positive_bounds",
      sql`${t.capacityPerSlot} >= 1 AND ${t.maxPartySize} >= 1 AND ${t.durationMin} BETWEEN 5 AND 480`,
    ),
    check("products_buffer_nonneg", sql`${t.bufferBeforeMin} >= 0 AND ${t.bufferAfterMin} >= 0`),
    index("products_business_status_idx").on(t.businessId, t.status, t.sortOrder),
  ],
);

/** ProductResource — 상품 ↔ 자원 N:M. */
export const productResources = pgTable(
  "product_resources",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
  },
  (t) => [
    primaryKey({ name: "product_resources_pk", columns: [t.productId, t.resourceId] }),
    index("product_resources_resource_idx").on(t.resourceId),
  ],
);
