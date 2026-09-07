import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** 모든 테이블의 uuid PK. PG 13+ 내장 gen_random_uuid() 를 쓴다 (pgcrypto 불필요). */
export const uuidPk = () => uuid("id").primaryKey().defaultRandom();

/** created_at / updated_at. updated_at 은 앱이 $onUpdate 로 갱신한다. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const createdAtOnly = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * PostgreSQL tstzrange. drizzle-orm 에 내장 타입이 없어 customType 으로 선언한다.
 * 값은 PG 텍스트 표기 그대로 다룬다 — 예: `["2026-09-07 10:00:00+09","2026-09-07 11:30:00+09")`.
 * 쓰기는 보통 SQL 식(`tstzrange(start_at - …, end_at + …, '[)')`)으로 하므로 드라이버 매핑을 두지 않는다.
 */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
});
