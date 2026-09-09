# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

에픽 #7 예약 엔진 ★ — **FR-BOOK-010·020·030·040·050·060·070 이 전부 들어왔다.** 남은 것은 알림·상담방 예약 카드(알림 에픽)뿐.
브랜치 `feat/7-booking-engine`. 마이그레이션 0005(감사 action)·0006(`guest_label`)·0007(replaces 인덱스) — **Neon 에 `npm run db:migrate` 필요.**
테스트: 슬롯 픽스처 40건 · 전이 표 검사 · DB 회귀 11건(동시성 4 + 변경·워크인 7, `DATABASE_URL` 이 test DB 일 때만).
Cloud Scheduler 에 C2(`/api/cron/expire-requests`, 5분)·C3(`/api/cron/auto-no-show`, 일 1회)를 걸어야 한다.

## 막힌 것

소셜 로그인·Resend·Cloud Scheduler·App Hosting 시크릿은 운영 작업(코드는 준비돼 있다).
**아직 정하지 못한 것은 전부 `LATER.md` (추후 논의).** 예약 엔진에 걸린 것은 L-06(슬롯 계산 가정 A1~A11 — 명세를 고칠지) · L-31(합산 잔여의 의미 — 예약 생성은 자원별 잔여로 검증한다).

## 다음 한 수

1. 에픽 #8 예약 콘솔 — 목록·필터·캘린더(FR-BOOK-080) · 예약 상세(승인/거절/취소/노쇼/담당자 변경) · 대시보드. 엔진은 다 됐고 화면이 없다.
2. 에픽 #11 예약 위젯 — `/api/public/products/:id/slots` 와 `POST /api/reservations` 를 쓰는 7단계 흐름.
3. 알림 최소본(확정·취소·거절 메일, Resend) — M2 편입분. 예약 생성 7단계의 마지막 조각.
4. 운영: App Hosting 시크릿 · Cloud Scheduler(C2·C3) · 관리자 승격 + TOTP
