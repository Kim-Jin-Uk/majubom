import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { globalRoleEnum, userProviderEnum, userStatusEnum } from "./enums";

/**
 * User (02 §2.2). 사업장 내 역할은 business_members 가 담당하고 여기는 전역 역할만 둔다.
 * 워크인 전용 내부 계정: provider=LOCAL, email=walkin+{businessId}@internal, password_hash=null.
 */
export const users = pgTable("users", {
  id: uuidPk(),
  /** NOT NULL — 소셜 로그인이 이메일을 주지 않으면 가입 단계에서 입력을 요구한다 (알림 폴백 채널). */
  email: varchar("email", { length: 320 }).notNull().unique(),
  phone: varchar("phone", { length: 32 }),
  name: varchar("name", { length: 100 }).notNull(),
  /** 소셜 전용 계정·워크인 계정은 null. */
  passwordHash: text("password_hash"),
  provider: userProviderEnum("provider").notNull(),
  globalRole: globalRoleEnum("global_role").notNull().default("USER"),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  ...timestamps,
});
