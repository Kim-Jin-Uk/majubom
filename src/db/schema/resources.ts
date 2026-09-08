import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { businessMembers, businesses } from "./businesses";
import { resourceTypeEnum } from "./enums";

/**
 * Resource — 예약 점유 대상 (02 §2.2).
 * capacity 는 타입과 무관하게 N 을 허용한다 (그룹 레슨 강사 STAFF 15, 다인 스튜디오 SPACE 4).
 * 예약 생성 시 `reservations.exclusive = (capacity = 1)` 로 스냅샷되어 배타 제약 대상이 갈린다.
 */
export const resources = pgTable(
  "resources",
  {
    id: uuidPk(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    type: resourceTypeEnum("type").notNull(),
    /** type=STAFF 이고 계정이 연결된 경우만. unique — 한 멤버는 최대 하나의 STAFF 자원. */
    memberId: uuid("member_id")
      .unique()
      .references(() => businessMembers.id),
    name: varchar("name", { length: 100 }).notNull(),
    imageUrl: text("image_url"),
    description: text("description"),
    capacity: integer("capacity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("resources_capacity_min", sql`${t.capacity} >= 1`),
    check("resources_member_only_staff", sql`${t.type} = 'STAFF' OR ${t.memberId} IS NULL`),
    index("resources_business_idx").on(t.businessId, t.sortOrder),
  ],
);
