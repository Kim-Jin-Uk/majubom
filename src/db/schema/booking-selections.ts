import { date, index, inet, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtOnly, uuidPk } from "./_common";
import { businesses } from "./businesses";
import { products } from "./products";
import { resources } from "./resources";

/**
 * BookingSelection — 예약 위젯의 **서버측 임시 선택 토큰** (FR-AUTH-030 · FR-SITE-020 [6], #83).
 *
 * 왜 서버에 두는가: 로그인 직전의 선택을 `sessionStorage` 에 두면 **같은 탭에서만** 살아남는다.
 * 카카오 로그인은 앱으로 나갔다 돌아오고, 이메일 검증 링크는 아예 다른 탭에서 열린다 — 그때마다 복원이 깨져
 * 손님은 상품 고르기부터 다시 한다. 명세가 30분 TTL 의 서버 토큰을 지정한 이유다.
 *
 * **로그인 전에 만들어지므로 사용자에 묶이지 않는다.** id 가 곧 열쇠다(uuid v4, 복귀 URL 에만 실린다).
 * 그래서 여기 담는 것은 손님이 **직접 고른 값**뿐이다 — 연락처도 이름도 담지 않는다. 만료된 행은
 * 정리 배치가 지운다(`/api/cron/cleanup-unverified`).
 *
 * 이 행은 예약을 만들지 않는다. 자리를 잡아 두지도 않는다 — 복원 뒤에도 슬롯은 그 시각에 다시 검증된다.
 */
export const bookingSelections = pgTable(
  "booking_selections",
  {
    id: uuidPk(),
    /** 복원할 때 "이 가게가 아직 공개인가" 를 보기 위한 것 */
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** 슬롯 조회가 돌려준 시작 시각 그대로 */
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    /**
     * 그 시각이 속한 **영업일**. 순간에서 되짚을 수 없어 따로 담는다 — 20:00~02:00 영업의 새벽 1시는
     * 달력으로 다음 날이지만 영업일은 전날이다. 이걸 안 담으면 복원한 손님이 하루 뒤 달력을 보게 된다
     */
    businessDate: date("business_date").notNull(),
    partySize: integer("party_size").notNull(),
    /** durationOptions 가 있는 상품만 의미가 있다 */
    durationMin: integer("duration_min"),
    /** 손님이 고른 자원. "상관없음" 은 null */
    resourceId: uuid("resource_id").references(() => resources.id),
    /** 요청사항 — 주소에 싣기엔 길다. 이 토큰이 있는 진짜 이유 */
    customerNote: text("customer_note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** 발급 IP — 로그인 없이 쓰는 유일한 쓰기 경로라 시간당 상한을 여기에 건다 (auth_tokens 와 같은 수법) */
    ip: inet("ip"),
    ...createdAtOnly,
  },
  (t) => [index("booking_selections_expires_idx").on(t.expiresAt), index("booking_selections_ip_created_idx").on(t.ip, t.createdAt)],
);
