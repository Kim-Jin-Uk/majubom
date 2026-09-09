# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #7 예약 엔진 ★ — **FR-BOOK-010 슬롯 조회 + FR-BOOK-020 예약 생성까지.** 픽스처 40건과 동시성 회귀 2건이 통과한다.
브랜치 `feat/7-booking-engine`(PR #158). 마이그레이션 0005(감사 action 2개) — **Neon 에 `npm run db:migrate` 필요.**
`POST /api/reservations` 는 프론트 결과를 믿지 않고 `computeSlots` 를 다시 부른다. 정원 1 은 배타 제약, 정원 N 은 advisory lock + 재계산.
로컬 테스트: `npm run db:seed:test`. 동시성 테스트는 DB 이름에 test 가 든 `DATABASE_URL` 일 때만 돈다(CI 는 자동).

## 막힌 것

소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업(코드는 준비돼 있다).
**아직 정하지 못한 것은 전부 `LATER.md` (추후 논의).** 예약 엔진에 걸린 것은 L-06(슬롯 계산 가정 A1~A11 — 명세를 고칠지) · L-31(합산 잔여의 의미 — 예약 생성은 자원별 잔여로 검증한다).

## 다음 한 수

1. FR-BOOK-030 승인/거절 — `validateExisting()`(신규 예약용 `computeSlots` 를 그대로 쓰면 안 된다: 바뀐 상품 설정·"유지하기로 한" 휴무까지 반영해 승인 불가로 만든다) · 조건부 UPDATE(0행 → 409) · `REQUESTED` 만료 `EXPIRED`.
2. FR-BOOK-040 취소 — 생성 시점 `cancelDeadlineHours` 스냅샷 기준. 취소 즉시 점유 해제.
3. FR-BOOK-070 워크인 대리 등록 — 사업장 내부 계정(`walkin+{businessId}@internal`), 정책(선행시간·한도)은 우회하되 자원 충돌 검증은 동일.
4. 운영: App Hosting 시크릿 · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
