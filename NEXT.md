# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #24 사업장 온보딩·설정 콘솔 — #25 위저드 · #26 기본정보·영업시간 · #27 정책 · #28 자원 · #29 공개 조건 · #30 권한 구현.
브랜치 `feat/3-business-console`. 같은 이메일 고객·사업자 겸업(사업자 가입이 기존 계정에 붙는다) 포함.
`npm run verify` · vitest · `next build` · Playwright 시나리오(owner/manager) 통과. 스키마 변경 없음.

## 막힌 것

3단계 "첫 예약 상품" 은 상품 에픽 #31 전까지 안내 문구 — 공개 조건 셋 중 하나가 늘 미충족이라 `live` 는 아직 못 된다.
소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 여전히 운영 작업 (features/auth/README.md).
Neon 에 남은 테스트 데이터는 클라우드/VM 에서 못 지운다 — Mac 에서 `npm run db:reset`.

## 다음 한 수

1. PR `feat(biz): 사업장 온보딩·설정 콘솔` 리뷰 반영 → 머지
2. 에픽 #31 상품·슬롯 (위저드 3단계를 실제 폼으로, `tests/fixtures/slot-cases.json` 이 슬롯 계산의 기준)
3. 운영: App Hosting 시크릿(`AUTH_SECRET` `AUTH_URL` `CRON_SECRET` `RESEND_API_KEY` R2 키) · Cloud Scheduler `cleanup-unverified` · 관리자 승격 + TOTP
