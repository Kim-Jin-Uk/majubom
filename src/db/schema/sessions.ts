import { index, inet, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAtOnly, uuidPk } from "./_common";
import { users } from "./users";

/**
 * Session — 서버 저장 리프레시 토큰 (06 §5 저장소 표, 02 FR-AUTH "세션 · 인증 정책").
 * 액세스 토큰(JWT 15분)은 무상태, 리프레시 토큰은 회전하며 여기 해시로만 저장한다.
 * 매니저 비활성화·사업장 정지·비밀번호 변경 시 해당 사용자 행을 전부 revoked 처리한다.
 * 02 §2.2 에 엔티티 표가 없어 최소 필드로 정의했다.
 *
 * 회전(0002): 리프레시 때마다 새 토큰을 발급하고 token_hash 를 바꾼다. 직전 해시는 prev_token_hash 에
 * 짧게(ROTATION_GRACE) 남겨 두어, 같은 순간 두 탭이 리프레시해도 한쪽이 강제 로그아웃되지 않게 한다.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuidPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** 리프레시 토큰 SHA-256. 원문은 저장하지 않는다. */
    tokenHash: text("token_hash").notNull().unique(),
    /** 직전 회전의 해시. rotated_at 부터 유예 시간 동안만 유효 */
    prevTokenHash: text("prev_token_hash"),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    /** "설치된 기기" 화면 표시용 */
    deviceLabel: varchar("device_label", { length: 100 }),
    userAgent: text("user_agent"),
    ip: inet("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...createdAtOnly,
  },
  (t) => [index("sessions_user_idx").on(t.userId, t.expiresAt)],
);
