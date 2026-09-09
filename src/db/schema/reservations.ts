import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAtOnly, timestamps, tstzrange, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { createdViaEnum, noShowSourceEnum, reservationStatusEnum } from "./enums";
import { products } from "./products";
import { resources } from "./resources";
import { users } from "./users";

/**
 * Reservation — 예약 (02 §2.2, FR-BOOK-020).
 *
 * 이중 예약 방어선:
 *   - exclusive = true (정원 1): EXCLUDE 제약 `no_overlap` 이 DB 레벨에서 중복 점유를 거부한다 (23P01).
 *     제약은 drizzle-kit 이 표현하지 못해 drizzle/0001_constraints.sql 에 있다.
 *   - exclusive = false (정원 N): pg_advisory_xact_lock(hashtext(resource_id::text)) 로 자원 단위 직렬화 후
 *     Σ party_size 를 재계산하고 INSERT 한다. 제약으로는 표현 불가.
 *
 * `exclusive` 는 **절대 nullable 로 만들지 않는다** — 제약 술어가 이 컬럼을 참조하므로 NULL 인 행은 제약 사정권 밖이다 (08 §5.3 ④).
 */
export const reservations = pgTable(
  "reservations",
  {
    id: uuidPk(),
    /** 고객 노출용 예약번호. 혼동 문자 제외 Base32 8자리. */
    code: varchar("code", { length: 8 }).notNull().unique(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    /** NOT NULL. 셀프 예약은 본인 계정, 워크인은 사업장 워크인 전용 내부 계정. */
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** [start_at − buffer_before, end_at + buffer_after) — 배타 제약 대상. CHECK 로 파생 규약을 고정한다. */
    occupyRange: tstzrange("occupy_range").notNull(),
    /** 생성 시점 자원 기준 스냅샷 = (resource.capacity = 1). true 인 행만 배타 제약 대상. */
    exclusive: boolean("exclusive").notNull().default(false),
    /** 아래 3개는 생성 시점 스냅샷 — 상품 설정을 나중에 바꿔도 기존 예약은 유지. */
    durationMin: integer("duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    /** FR-BIZ-020 — 정책 변경은 미래 예약에만 적용되므로 취소 마감도 스냅샷한다. */
    cancelDeadlineHours: integer("cancel_deadline_hours").notNull(),
    partySize: integer("party_size").notNull().default(1),
    status: reservationStatusEnum("status").notNull(),
    /** MANUAL(매니저 처리) / AUTO(배치). 노쇼율 지표에서 AUTO 는 분모 제외. */
    noShowSource: noShowSourceEnum("no_show_source"),
    /** 워크인 대리 등록에서 받은 표시용 이름 (FR-BOOK-070). 계정이 아니라 라벨이라 검증하지 않는다 — 고객 식별에 쓰지 않는다 */
    guestLabel: varchar("guest_label", { length: 60 }),
    customerNote: text("customer_note"),
    /** 매니저 전용, 고객 비공개 */
    internalMemo: text("internal_memo"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** 예약 변경으로 생성된 건이 대체한 원 예약 (FR-BOOK-050) */
    replacesReservationId: uuid("replaces_reservation_id").references((): AnyPgColumn => reservations.id),
    createdVia: createdViaEnum("created_via").notNull(),
    ...timestamps,
  },
  (t) => [
    // 02 §2.2 Reservation CHECK
    check("reservations_time_order_party", sql`${t.startAt} < ${t.endAt} AND ${t.partySize} >= 1`),
    check("reservations_occupy_covers", sql`${t.occupyRange} @> tstzrange(${t.startAt}, ${t.endAt})`),
    // 버퍼 스냅샷과 점유 구간의 파생 규약. 앱이 다른 값을 넣으면 23514.
    check(
      "reservations_occupy_derivation",
      sql`${t.occupyRange} = tstzrange(${t.startAt} - (${t.bufferBeforeMin} * interval '1 minute'), ${t.endAt} + (${t.bufferAfterMin} * interval '1 minute'), '[)')`,
    ),
    check("reservations_buffer_nonneg", sql`${t.bufferBeforeMin} >= 0 AND ${t.bufferAfterMin} >= 0`),
    check("reservations_no_show_source_only_no_show", sql`${t.noShowSource} IS NULL OR ${t.status} = 'NO_SHOW'`),
    index("reservations_resource_start_idx").on(t.resourceId, t.startAt),
    index("reservations_customer_start_idx").on(t.customerId, t.startAt),
    index("reservations_business_status_idx").on(t.businessId, t.status),
    index("reservations_business_start_idx").on(t.businessId, t.startAt),
  ],
);

/** ReservationLog — 상태 변경 이력 (누가, 언제, 무엇을, 왜). 이관은 from/to resource 로 남긴다 (FR-SHIFT-020). */
export const reservationLogs = pgTable(
  "reservation_logs",
  {
    id: uuidPk(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    /** 생성 시에는 null */
    fromStatus: reservationStatusEnum("from_status"),
    toStatus: reservationStatusEnum("to_status").notNull(),
    fromResourceId: uuid("from_resource_id").references(() => resources.id),
    toResourceId: uuid("to_resource_id").references(() => resources.id),
    /** 배치(만료·자동 노쇼)가 전이시키면 null */
    actorId: uuid("actor_id").references(() => users.id),
    /** 사유 필수 전이는 앱이 400 으로 막는다. 분쟁 대응용으로 마스킹 대상에서 제외 (FR-PRIV-010). */
    reason: text("reason"),
    ...createdAtOnly,
  },
  (t) => [index("reservation_logs_reservation_idx").on(t.reservationId, t.createdAt)],
);
