# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #37 휴무일·근무표 콘솔 — #38 휴무(반복/일회성/자원별/부분) · #39 주간 패턴(버전·일괄) · #40 예외(OFF/MODIFIED/BLOCK/EXTRA·예약 충돌) · #41 조회(주간 그리드·요약) · #42 매니저 BLOCK.
+ 매니저 휴가 신청(종일/시간 → PENDING, 사장님 승인 후 적용 — `work_exceptions.status`, 마이그레이션 0003·0004 **Neon 에 `npm run db:migrate` 필요**).
브랜치 `feat/5-schedule`, PR #157 (리뷰 2회 반영). `resolveWorkDay` 가 우선순위 8단계의 정본 — 슬롯 엔진이 이걸 쓴다 (APPROVED 예외만 넘길 것 — `applicable()`).
로컬 테스트: `npm run db:seed:test` (사장님·매니저·고객 계정, 자원·패턴·예약·휴가 신청 시드).
직전: 에픽 #31 상품 콘솔 PR #156 머지(a67263f).

## 막힌 것

소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업(코드는 준비돼 있다).
**아직 정하지 못한 것은 전부 `LATER.md` (추후 논의).** 예약 엔진을 시작하기 전에 L-06(슬롯 계산 가정 A1~A11)·L-07 은 읽고 들어갈 것.

## 다음 한 수

1. PR #157(근무표) 머지 → Neon `db:migrate`(0003·0004) → `db:seed:test` 로 로컬 확인
2. 에픽 예약 엔진 ★ (FR-BOOK-010 슬롯 계산 — `tests/fixtures/slot-cases.json` 40건이 기준, `resolveWorkDay`(APPROVED 만)·`peakOccupancy` 재사용). 감사 action `BUSINESS_UPDATE`·`MEMBER_REACTIVATE` 를 이때 마이그레이션에 묶는다(L-20)
3. 운영: App Hosting 시크릿 · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
