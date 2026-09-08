# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

메인 이슈 #15 인증·계정 — 세부 8건 전부 구현 (#16 코어 · #17 화면 · #18 사업자 가입 · #19 초대 · #20 재설정 · #21 세션 · #22 TOTP · #23 Firebase 토큰).
브랜치 `feat/2-auth`. `npm run verify` · `db:check` 9/9 · `next build` 통과. 마이그레이션 0002_auth (expand 전용).

## 막힌 것

소셜 로그인은 env 가 없어 버튼이 꺼져 있다 — Google OAuth 클라이언트(GCP 콘솔)와 카카오 앱(#12)을 만들면 켜진다.
메일은 RESEND_API_KEY 없이 콘솔 폴백 — Resend 가입 + 도메인 검증(majubom.kr, #12) 전에는 onboarding@resend.dev 로 본인 주소만.
명세 모순 A1·A7(#13 코멘트)은 #48 전에 결정. 사업자등록증 첨부·CAPTCHA·관리자 알림은 의도적으로 뒤로 (features/auth/README.md "아직 안 한 것").

## 다음 한 수

1. PR `feat(auth): 인증·계정` 머지 후 프로덕션 마이그레이션(migrate.yml 이 0002 적용) 확인 → App Hosting 시크릿에 `AUTH_SECRET` `AUTH_URL` `CRON_SECRET` 등록
2. 에픽 #24 사업장 온보딩·설정 콘솔(3-1 위저드부터) — `/console` 자리표시자를 대체. 매니저 초대 화면은 `/console/resources` 로 합친다(#28)
3. Cloud Scheduler: 매일 03:00 KST `POST /api/cron/cleanup-unverified` (Bearer CRON_SECRET)
