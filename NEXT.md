# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #7 예약 엔진 ★ — **FR-BOOK-010 가용 슬롯 조회까지 됐다.** `computeSlots` 는 순수 함수이고 `tests/fixtures/slot-cases.json` 40건이 전부 통과한다.
브랜치 `feat/7-booking-engine`(main 위, 스키마 변경 없음). 공개 API `GET /api/public/products/:id/slots?date&to&partySize&durationMin&resourceId`.
직전: 에픽 #37 근무표 PR #157 머지(e3f2787) + 매니저 휴가 신청. 로컬 테스트는 `npm run db:seed:test` (사업장이 APPROVED 로 들어간다 — 공개 API 가 승인 사업장만 답한다).

## 막힌 것

소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업(코드는 준비돼 있다).
**아직 정하지 못한 것은 전부 `LATER.md` (추후 논의).** 예약 엔진에 걸린 것은 L-06(슬롯 계산 가정 A1~A11 — 명세를 고칠지) · L-31(합산 잔여의 의미) · L-09(maxActivePerCustomer 경쟁 조건).

## 다음 한 수

1. FR-BOOK-020 예약 생성 — `exclusive` 스냅샷 · EXCLUDE 제약(정원 1) · advisory lock + 재계산(정원 N) · 40P01 재시도 · 409 `SLOT_TAKEN` + 대체 시각 3개.
   트랜잭션 안에서 `computeSlots` 를 그대로 다시 불러 재검증한다(프론트 결과를 믿지 않는다).
2. 그 마이그레이션에 감사 action `BUSINESS_UPDATE`·`MEMBER_REACTIVATE` 를 묶는다 (`LATER.md` L-20).
3. 동시성 회귀 테스트(정원 1 에 20요청 → 1건 / 정원 15 에 20요청 → 15건)를 CI 에 상주시킨다.
4. 운영: App Hosting 시크릿 · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
