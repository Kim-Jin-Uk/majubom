# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #31 예약 상품 콘솔 — #32 등록 폼(프리셋·3스위치·회차 시간표) · #33 이미지(R2 presign 업로드·정렬·대표) · #34 자원 매핑·선택 방식 · #35 수정(매니저 제한·미래 예약 확인) · #36 삭제→보관.
브랜치 `feat/4-product-console`. 위저드 3단계가 실제 폼이 됐다. 스키마 변경 없음.
`npm run verify` · vitest · `next build` · Playwright(상품 흐름·검증·수정 영향·삭제) 통과. 설계 기록 `src/features/product/README.md`.

## 막힌 것

로컬(클라우드·VM)에는 R2 env 가 없어 이미지 업로드는 URL 직접 입력으로만 확인했다 — Mac 은 .env.local 에 R2 가 있으니 실제 업로드 확인은 거기서.
`fixedIgnoreBreaks` 는 컬럼 없이 항상 true. 감사 action 세분화(BUSINESS_UPDATE 등)는 여전히 다음 마이그레이션 때.
소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업 (features/auth/README.md).

## 다음 한 수

1. PR `feat(prd): 예약 상품 콘솔` 리뷰 반영 → 머지
2. 에픽 #37 휴무일·근무표 콘솔 (FR-SCH) → 그 다음 예약 엔진 ★ (`tests/fixtures/slot-cases.json` 이 슬롯 계산의 기준)
3. 운영: App Hosting 시크릿 · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
