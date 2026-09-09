# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #7 예약 엔진 ★ — **슬롯 조회(010) · 생성(020) · 상태 전이(030·040·060)** 까지. 픽스처 40건 + 동시성 회귀 4건 + 전이 표 검사가 통과한다.
브랜치 `feat/7-booking-engine`(PR #159 = 생성, 그 위에 전이). 마이그레이션 0005 — **Neon 에 `npm run db:migrate` 필요.**
전이 표는 `features/booking/transition-rules.ts` 하나. 승인 재검증(`validateExisting`)은 `computeSlots` 를 쓰지 않는다 — 바뀐 상품 설정으로 기존 예약을 막지 않으려고.
배치 둘: `/api/cron/expire-requests`(C2, 5분) · `/api/cron/auto-no-show`(C3, 일 1회). 로컬은 `npm run job:reservations`.

## 막힌 것

소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업(코드는 준비돼 있다).
**아직 정하지 못한 것은 전부 `LATER.md` (추후 논의).** 예약 엔진에 걸린 것은 L-06(슬롯 계산 가정 A1~A11 — 명세를 고칠지) · L-31(합산 잔여의 의미 — 예약 생성은 자원별 잔여로 검증한다).

## 다음 한 수

1. FR-BOOK-070 워크인 대리 등록 — `guestLabel` 컬럼 추가(마이그레이션) · 사업장 워크인 내부 계정 · `createdVia=WALK_IN` 즉시 CONFIRMED ·
   정책(선행시간·가능일·한도)은 우회하되 **자원 충돌 검증은 동일** · 리뷰 자격 제외.
2. FR-BOOK-050 예약 변경 — `replacesReservationId`. 한도에서 원 예약 제외 · `peakOccupancy(excludeId)` · exclusive 면 같은 트랜잭션에서 원 예약을 먼저 취소.
3. 에픽 #8 예약 콘솔 — 목록·상세·캘린더(FR-BOOK-080). 지금은 API 만 있고 화면이 없다.
4. 운영: App Hosting 시크릿 · Cloud Scheduler(C2·C3 추가) · 관리자 승격 + TOTP
