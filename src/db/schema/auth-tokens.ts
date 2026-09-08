import { index, inet, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtOnly, uuidPk } from "./_common";
import { authTokenKindEnum } from "./enums";
import { users } from "./users";

/**
 * AuthToken — 단일사용 토큰 (0002). 02 §2.2 에 엔티티 표가 없어 여기서 정의했다.
 *
 * | kind           | 용도                                         | 만료  | 근거        |
 * |----------------|----------------------------------------------|-------|-------------|
 * | EMAIL_OTP      | 사업자 가입 이메일 OTP 6자리                  | 10분  | FR-AUTH-010 |
 * | EMAIL_VERIFY   | 고객 이메일 검증 링크 (비동기)                | 24시간| FR-AUTH-030 |
 * | INVITE         | 매니저 초대 링크                              | 72시간| FR-AUTH-020 |
 * | PASSWORD_RESET | 비밀번호 재설정 링크                          | 30분  | FR-AUTH-040 |
 *
 * 원문은 저장하지 않는다 — token_hash 는 SHA-256. OTP 는 `sha256(userId + ":" + code)` 로 사용자에 묶는다.
 * used_at 이 찍히면 재사용 불가. attempts 는 OTP 오입력 횟수(5회 초과 시 폐기).
 * ip 는 발급 IP — 사업자 가입 "동일 IP 시간당 3건" 레이트리밋의 근거.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuidPk(),
    kind: authTokenKindEnum("kind").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    ip: inet("ip"),
    ...createdAtOnly,
  },
  (t) => [
    index("auth_tokens_user_kind_idx").on(t.userId, t.kind),
    index("auth_tokens_ip_created_idx").on(t.ip, t.createdAt),
  ],
);
