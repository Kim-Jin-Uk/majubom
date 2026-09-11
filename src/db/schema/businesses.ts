import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAtOnly, timestamps, uuidPk } from "./_common";
import { businessPlanEnum, businessStatusEnum, memberRoleEnum, memberStatusEnum } from "./enums";
import { users } from "./users";

/** Business.openingHours 요소 — 요일별 영업시간. breaks 는 최대 2구간. */
export type OpeningHour = {
  dow: number;
  open: string;
  close: string;
  breaks?: { start: string; end: string }[];
};

/** FR-BIZ-020 예약 정책. 기본값은 코드 쪽 상수에서 채운다. */
export type BusinessPolicy = {
  autoConfirm: boolean;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  cancelDeadlineHours: number;
  /** 고객 1명이 **같은 상품**에 동시에 들고 있을 수 있는 예약 수 (확정 + 대기). 다른 상품은 따로 센다 — `booking/create.ts` */
  maxActivePerCustomer: number;
  autoNoShowAfterHours: number;
  requestExpireHours: number;
  reviewEnabled: boolean;
  shiftAutoApprove: boolean;
};

export const businesses = pgTable(
  "businesses",
  {
    id: uuidPk(),
    /** 공개 URL /@{slug}. 영소문자+숫자+하이픈 3~30자. 변경된 구 slug 는 business_slug_history 에 영구 보관. */
    slug: varchar("slug", { length: 30 }).notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    bizRegNo: varchar("biz_reg_no", { length: 20 }).notNull().unique(),
    category: varchar("category", { length: 50 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    address: text("address"),
    addressDetail: text("address_detail"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    description: text("description"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Seoul"),
    openingHours: jsonb("opening_hours").$type<OpeningHour[]>().notNull().default([]),
    status: businessStatusEnum("status").notNull().default("PENDING"),
    plan: businessPlanEnum("plan").notNull().default("FREE"),
    policy: jsonb("policy").$type<BusinessPolicy>().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    /** null 이면 심사 큐에 노출되지 않고 7일 후 자동 삭제 (FR-AUTH-010). */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("businesses_slug_format", sql`${t.slug} ~ '^[a-z0-9-]{3,30}$'`),
    index("businesses_status_idx").on(t.status),
  ],
);

/**
 * 한 번 사용된 slug 는 영구 예약된다 (FR-BIZ-010). 구 URL → 새 URL 301 의 근거 테이블.
 * 현재 slug 도 여기 한 행을 가진다 — 그래야 "이 slug 는 누구 것인가" 조회가 한 곳에서 끝난다.
 */
export const businessSlugHistory = pgTable(
  "business_slug_history",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    slug: varchar("slug", { length: 30 }).notNull().unique(),
    ...createdAtOnly,
  },
  (t) => [index("business_slug_history_business_idx").on(t.businessId)],
);

/** BusinessMember.permissions — 키 4개 고정. 목록에 없는 키는 저장 시 무시한다. */
export type MemberPermissions = {
  editProduct?: boolean;
  replyReview?: boolean;
  viewAllReservations?: boolean;
  handleChat?: boolean;
};

/** User ↔ Business 관계 + 사업장 내 역할. 사업자(OWNER)도 근무표에 편입될 수 있어 별도 테이블로 나누지 않는다. */
export const businessMembers = pgTable(
  "business_members",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    role: memberRoleEnum("role").notNull(),
    permissions: jsonb("permissions").$type<MemberPermissions>().notNull().default({}),
    status: memberStatusEnum("status").notNull().default("INVITED"),
    ...timestamps,
  },
  (t) => [
    unique("business_members_user_business_uq").on(t.userId, t.businessId),
    index("business_members_business_idx").on(t.businessId),
  ],
);
