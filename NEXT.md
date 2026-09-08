# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #37 휴무일·근무표 콘솔 — #38 휴무(반복/일회성/자원별/부분) · #39 주간 패턴(버전·일괄) · #40 예외(OFF/MODIFIED/BLOCK/EXTRA·예약 충돌) · #41 조회(주간 그리드·요약) · #42 매니저 BLOCK.
브랜치 `feat/5-schedule`(상품 브랜치 위). `resolveWorkDay` 가 우선순위 8단계의 정본 — 슬롯 엔진이 이걸 쓴다. 스키마 변경 없음.
직전: 에픽 #31 상품 콘솔 PR #156 (리뷰 2회 반영, 머지 대기).

## 막힌 것

휴무 등록 시 "일괄 취소 + 고객 알림" 은 예약 취소·알림이 생겨야 한다 — 지금은 "예약은 두고 등록" 만.
자정 넘기는 근무 패턴은 DB CHECK 가 막는다(심야 사업장 생기면 완화). 소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업.

## 다음 한 수

1. PR #156(상품) 머지 → PR `feat(sch): 휴무일·근무표 콘솔` 리뷰 반영 → 머지
2. 에픽 예약 엔진 ★ (FR-BOOK-010 슬롯 계산 — `tests/fixtures/slot-cases.json` 40건이 기준, `resolveWorkDay`·`peakOccupancy` 재사용)
3. 운영: App Hosting 시크릿 · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
