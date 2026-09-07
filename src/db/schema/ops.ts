import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAtOnly, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { auditActionEnum, reportStatusEnum, reportTargetTypeEnum } from "./enums";
import { users } from "./users";

/**
 * AuditLog — 감사 로그 (FR-ADM-040). 보존 1년.
 * diff 는 **변경된 필드만**. 연락처·이메일은 적재 시점부터 해시 (FR-PRIV-010).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuidPk(),
    /** 배치·시스템 행위는 null */
    actorId: uuid("actor_id").references(() => users.id),
    /** 행위 시점의 역할 스냅샷 (ADMIN / OWNER / MANAGER / CUSTOMER / SYSTEM) */
    actorRole: varchar("actor_role", { length: 20 }),
    businessId: uuid("business_id").references(() => businesses.id),
    action: auditActionEnum("action").notNull(),
    targetType: varchar("target_type", { length: 40 }),
    /** Firestore 문서 id(`{businessId}_{customerId}`)도 들어오므로 uuid 가 아니라 text */
    targetId: text("target_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    ...createdAtOnly,
  },
  (t) => [
    index("audit_logs_business_created_idx").on(t.businessId, t.createdAt),
    index("audit_logs_actor_created_idx").on(t.actorId, t.createdAt),
    index("audit_logs_action_created_idx").on(t.action, t.createdAt),
  ],
);

/**
 * UsageCounter — 사업장 × 일 단위 사용량 집계 (FR-ADM-030, C4 배치 매일 03:00).
 * 명세에 컬럼 정의가 없어 FR-ADM-030 지표 표에서 도출했다. 소급 집계 기준 `lastAggregatedDate` 는
 * 별 컬럼 대신 `max(date)` 로 구한다.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    date: date("date").notNull(),
    /** 그날 생성된 예약 수 (상태 무관) */
    reservationCount: integer("reservation_count").notNull().default(0),
    /** 그날 발송된 Notification 수 */
    notificationCount: integer("notification_count").notNull().default(0),
    /** 그날 기준 스냅샷 지표 */
    activeManagerCount: integer("active_manager_count").notNull().default(0),
    productCount: integer("product_count").notNull().default(0),
    imageStorageMb: integer("image_storage_mb").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    aggregatedAt: timestamp("aggregated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "usage_counters_pk", columns: [t.businessId, t.date] }),
    check(
      "usage_counters_nonneg",
      sql`${t.reservationCount} >= 0 AND ${t.notificationCount} >= 0 AND ${t.activeManagerCount} >= 0 AND ${t.productCount} >= 0 AND ${t.imageStorageMb} >= 0`,
    ),
  ],
);

/** Report — 신고 (FR-ADM-060). 대상이 Firestore 채팅방/메시지일 수 있어 target_id 는 text. */
export const reports = pgTable(
  "reports",
  {
    id: uuidPk(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    targetType: reportTargetTypeEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    status: reportStatusEnum("status").notNull().default("PENDING"),
    handledBy: uuid("handled_by").references(() => users.id),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    note: text("note"),
    ...createdAtOnly,
  },
  (t) => [
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_target_idx").on(t.targetType, t.targetId),
  ],
);
