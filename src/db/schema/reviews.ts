import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { businessMembers, businesses } from "./businesses";
import { reviewStatusEnum } from "./enums";
import { products } from "./products";
import { reservations } from "./reservations";
import { users } from "./users";

/** Review — 예약 1건당 리뷰 1건 (reservation_id unique). */
export const reviews = pgTable(
  "reviews",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    rating: integer("rating").notNull(),
    /** 10자 이상 (앱 검증) */
    content: text("content").notNull(),
    /** 최대 3장 (앱 검증) */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    status: reviewStatusEnum("status").notNull().default("PUBLISHED"),
    ...timestamps,
  },
  (t) => [
    check("reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
    index("reviews_business_created_idx").on(t.businessId, t.createdAt),
  ],
);

/** ReviewReply — 사업자 답글, 리뷰당 1건. */
export const reviewReplies = pgTable("review_replies", {
  id: uuidPk(),
  reviewId: uuid("review_id")
    .notNull()
    .unique()
    .references(() => reviews.id),
  /** 작성한 BusinessMember */
  memberId: uuid("member_id")
    .notNull()
    .references(() => businessMembers.id),
  /** 500자 (앱 검증) */
  content: text("content").notNull(),
  ...timestamps,
});
