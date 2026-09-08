import { index, integer, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { globalRoleEnum, userProviderEnum, userStatusEnum } from "./enums";

/**
 * User (02 §2.2). 사업장 내 역할은 business_members 가 담당하고 여기는 전역 역할만 둔다.
 * 워크인 전용 내부 계정: provider=LOCAL, email=walkin+{businessId}@internal, password_hash=null.
 *
 * 인증 관련 컬럼 (0002, FR-AUTH-030):
 * - provider_account_id: 소셜 제공자의 사용자 식별자. (provider, provider_account_id) unique.
 *   소셜 계정은 이 쌍으로만 식별한다 — 이메일 일치로 자동 연결하는 것은 제공자가 이메일 검증을 보증할 때만.
 * - email_verified_at: 고객 이메일 검증 시각. null 이면 MARKETING 알림 보류 (검증 전 예약 확정은 허용).
 * - totp_secret_enc / totp_enabled_at / totp_last_step: ADMIN 2단계 인증. 시크릿은 AUTH_SECRET 파생 키로 암호화해 저장.
 * - (provider, provider_account_id) unique 는 "계정당 소셜 1개" 를 뜻한다. LOCAL 은 NULL 이라 무한히 허용된다(NULLS DISTINCT).
 */
export const users = pgTable(
  "users",
  {
    id: uuidPk(),
    /** NOT NULL — 소셜 로그인이 이메일을 주지 않으면 가입 단계에서 입력을 요구한다 (알림 폴백 채널). */
    email: varchar("email", { length: 320 }).notNull().unique(),
    phone: varchar("phone", { length: 32 }),
    name: varchar("name", { length: 100 }).notNull(),
    /** 소셜 전용 계정·워크인 계정은 null. */
    passwordHash: text("password_hash"),
    provider: userProviderEnum("provider").notNull(),
    /** LOCAL 은 null. 소셜은 제공자가 준 id 문자열 */
    providerAccountId: varchar("provider_account_id", { length: 191 }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    /** 마지막으로 통과한 TOTP 스텝(30초 단위). 같은 코드의 재사용(리플레이)을 막는다 — 단조 증가만 허용 */
    totpLastStep: integer("totp_last_step"),
    globalRole: globalRoleEnum("global_role").notNull().default("USER"),
    status: userStatusEnum("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (t) => [
    unique("users_provider_account_uq").on(t.provider, t.providerAccountId),
    index("users_status_idx").on(t.status),
  ],
);
