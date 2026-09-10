# DB 스키마 — 마주,봄

정본은 `02_기능명세서.md` §2.2 (엔티티) · §3.7 FR-BOOK-020 (동시성) · `08_코드관리_전략.md` §5 (마이그레이션 규약). 이 문서는 대응표와 이 코드베이스에서만 결정한 것들만 적는다.

## 엔티티 ↔ 테이블

| 명세 엔티티 | 테이블 | 파일 | 비고 |
|---|---|---|---|
| User | `users` | `users.ts` | 워크인 내부 계정도 여기 (`email=walkin+{businessId}@internal`) |
| Business | `businesses` | `businesses.ts` | `slug` CHECK `^[a-z0-9-]{3,30}$` |
| — (FR-BIZ-010 slug 영구 예약) | `business_slug_history` | `businesses.ts` | 명세에 엔티티 표는 없지만 "영구 예약 + 301" 을 저장할 곳이 필요해 추가. 현재 slug 도 한 행을 가진다 |
| BusinessMember | `business_members` | `businesses.ts` | `(user_id, business_id)` unique |
| Resource | `resources` | `resources.ts` | `member_id` unique, `type='STAFF' OR member_id IS NULL` |
| Product | `products` | `products.ts` | 명세 CHECK 3종 + 버퍼 ≥ 0 |
| ProductResource | `product_resources` | `products.ts` | 복합 PK |
| Holiday | `holidays` | `schedules.ts` | |
| WorkSchedule | `work_schedules` | `schedules.ts` | EXCLUDE `work_schedule_no_overlap` (0001) |
| WorkException | `work_exceptions` | `schedules.ts` | |
| ShiftSwapRequest | `shift_swap_requests` | `schedules.ts` | |
| Reservation | `reservations` | `reservations.ts` | EXCLUDE `no_overlap` (0001) · `occupy_range` 파생 CHECK · `cancel_deadline_hours` 스냅샷(FR-BIZ-020) |
| ReservationLog | `reservation_logs` | `reservations.ts` | `from/to_status` + 이관용 `from/to_resource_id` |
| Review | `reviews` | `reviews.ts` | `reservation_id` unique |
| ReviewReply | `review_replies` | `reviews.ts` | `review_id` unique |
| SitePage (Section·Block 은 jsonb) | `site_pages` | `site-pages.ts` | `business_id` unique (MVP 1페이지) |
| BookingSelection (위젯 임시 선택) | `booking_selections` | `booking-selections.ts` | 사용자에 안 묶인다 — 로그인 **전에** 만들어진다. 30분 TTL |
| PushSubscription | `push_subscriptions` | `notifications.ts` | FCM 토큰 1개만 (`fcm_token` unique). VAPID 3종 보관 안 함 |
| Notification | `notifications` | `notifications.ts` | `event_type` enum 코드는 `enums.ts` 참조 |
| NotificationPreference | `notification_preferences` | `notifications.ts` | `(user_id, event_group)` PK |
| AuditLog | `audit_logs` | `ops.ts` | `target_id` 는 text (Firestore 문서 id 수용) |
| UsageCounter | `usage_counters` | `ops.ts` | `(business_id, date)` PK. 컬럼은 FR-ADM-030 지표에서 도출 |
| Report | `reports` | `ops.ts` | `target_id` 는 text |
| Session (06 §5) | `sessions` | `sessions.ts` | 서버 저장 리프레시 토큰 해시. 02 §2.2 에 표가 없어 최소 필드 |
| **ChatRoom · ChatMessage** | **없음** | — | **Firestore** `chatRooms/{roomId}(/messages)` 에 산다 (06 §5). Postgres 에 만들지 않는다 — `db:check` 가 존재 자체를 실패로 본다 |

규약: 테이블 복수형 snake_case, PK `uuid DEFAULT gen_random_uuid()`, 시각 `timestamptz`, 금액은 integer(원) — 현재 금액 컬럼은 없다(`price_display` 는 표시 문자열), enum 은 `pgEnum`, jsonb 는 TS 타입(`$type`)을 붙인다.

## 예약 방식 = 세 스위치 (Product)

업종별 모델을 두지 않는다. 상품의 세 필드 묶음이 예약 방식을 결정한다.

| 스위치 | 컬럼 | 값 |
|---|---|---|
| 시작 시각 | `start_mode` + `slot_interval_min` / `fixed_start_times` | FREE(간격으로 어디서든) / FIXED(정한 시각만) |
| 이용 시간 | `duration_min` / `duration_options` | 상품 고정 / 고객 선택 (FIXED 에서는 불가 — CHECK) |
| 정원 | `capacity_per_slot` ≤ min(연결 자원 `capacity`) | 1 / N |

## `exclusive` 와 두 가지 동시성 메커니즘 (Reservation)

`reservations.exclusive boolean NOT NULL DEFAULT false` 는 **생성 시점 자원 스냅샷** `= (resource.capacity = 1)` 이다.

- `exclusive = true` (정원 1): EXCLUDE 제약 `no_overlap` — `(resource_id WITH =, occupy_range WITH &&) WHERE (exclusive AND status IN ('REQUESTED','CONFIRMED'))`. 겹치면 PG 가 `23P01` 로 거부한다 → 앱은 `409 SLOT_TAKEN`.
- `exclusive = false` (정원 N): 제약으로 표현 불가(`Σ party_size ≤ capacity` 는 쌍 단위 검사가 아니다). 앱이 `pg_advisory_xact_lock(hashtext(resource_id::text))` 로 자원 단위 직렬화 후 점유 합을 재계산하고 INSERT 한다.

`occupy_range tstzrange NOT NULL` 은 `[start_at − buffer_before_min, end_at + buffer_after_min)` 이며 CHECK `reservations_occupy_derivation` 이 이 파생 규약을 강제한다 — 앱이 버퍼를 빼먹고 넣으면 `23514`.

**절대 규칙 (08 §5.3~5.4):** `exclusive` 를 nullable 로 만들지 않는다(NULL 이면 술어가 NULL 로 떨어져 제약 사정권 밖). 마이그레이션에 `CASCADE` 를 쓰지 않는다. `btree_gist` 를 지우지 않는다(제약이 함께 사라진다). 셋 다 `npm run db:check` 가 잡는다.

## 마이그레이션 구성 — drizzle-kit 이 못 표현하는 것을 어디에 두었나

```
drizzle/
  0000_init.sql          drizzle-kit generate 산출물 + 최상단에 CREATE EXTENSION IF NOT EXISTS btree_gist 를 손으로 추가
  0001_constraints.sql   drizzle-kit generate --custom 으로 만든 빈 파일에 EXCLUDE 제약 2개 + 사전 검증 DO 블록
  meta/                  0000·0001 스냅샷 + _journal.json (둘 다 drizzle-kit 이 만든 것, 손대지 않았다)
```

- drizzle-orm 0.45 / drizzle-kit 0.31 은 `EXCLUDE` 제약과 `CREATE EXTENSION` 을 스키마 DSL 로 표현하지 못한다. 대신 **`--custom` 마이그레이션**을 썼다. 이 방식이면 `0001_snapshot.json` 은 0000 과 같은 스키마를 가리키므로 `drizzle-kit generate` 를 다시 돌려도 드리프트가 0 이다(확인됨: "No schema changes").
- 확장은 규약(08 §5.3 ③)대로 **첫 마이그레이션 최상단**에 있어야 하므로 0000 에 손으로 넣었다. SQL 파일 편집은 스냅샷에 영향이 없다.
- `occupy_range` 는 `customType` (`_common.ts` `tstzrange`) 으로 스키마에 표현했고, CHECK 는 drizzle `check()` 로 표현했다 — 둘 다 스냅샷에 들어가므로 드리프트 검사 대상이다.
- W15 스쿼시 때 0000 을 재생성하면 **확장 한 줄을 다시 붙여야 한다.** `db:check` 의 첫 항목이 그걸 잡는다.

## 명세와 다르게 판단한 곳

| 항목 | 판단 | 이유 |
|---|---|---|
| `business_slug_history` 추가 | 테이블 신설 | FR-BIZ-010 "영구 예약 + 301" 은 저장 없이 구현 불가 |
| `sessions`, `usage_counters` 컬럼 | 최소 필드로 정의 | 06 §5 저장소 표에 있으나 02 §2.2 에 컬럼 정의가 없음. FR-AUTH 세션 정책 / FR-ADM-030 지표에서 도출 |
| `notification_event_type` 코드 | 22개 코드를 확정 | FR-NOTI-010 은 이벤트 이름만 있고 코드 문자열이 없음 |
| `reservations.cancel_deadline_hours` | 컬럼 추가 | FR-BIZ-020 "Reservation 에 cancelDeadlineHours 스냅샷" 지시. §2.2 표에는 빠져 있음 |
| `reservation_logs.from/to_resource_id` | 컬럼 추가 | FR-SHIFT-020 이관 기록 지시 |
| `work_schedules.effective_to` nullable | 허용 | "종료일 미정" 패턴. `daterange(from, NULL, '[]')` 은 상한 무한으로 EXCLUDE 에 자연스럽게 참여 |
| `audit_logs.target_id`, `reports.target_id` | uuid 아닌 text | 신고·감사 대상에 Firestore 문서 id(`{businessId}_{customerId}`) 가 들어온다 |
| ChatRoom / ChatMessage | 미생성 | Firestore (06 §5) |
| 플랜 한도(`/admin/plans`) | 미생성 | §2.2 엔티티 목록에 없음. 필요 시 별도 마이그레이션 |
