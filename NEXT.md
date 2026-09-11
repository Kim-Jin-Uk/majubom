# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

**9/11 — 에픽 #6·#7·#9 앞부분이 한꺼번에 `main` 에 들어갔다.** `main` 은 `80310a4` 이고, 그 앞에
`1987499`(#177) 하나뿐이다. #181 이 **스쿼시 머지**라 그 한 커밋에 세 덩어리가 같이 담겼다:

- **#57 손님 메일** — 접수·확정·거절·매장취소·만료 다섯 통 (`features/booking/notify.ts`, `lib/mail/templates.ts`).
  어떤 전이가 어떤 메일인지는 전이 표 옆 `transition-rules.ts` 의 `CUSTOMER_MAIL_ON` 에 있다
- **#43~#46 근무 교대** — `features/schedule/swap-rules.ts`(순수) + `swaps.ts`, `/console/schedule/swaps`,
  크론 C8 `/api/cron/expire-swaps`(매시, 72시간 만료)
- **#65·#66 관리자 콘솔** — 가입 심사 · 사업장 상태 제어 (`features/admin/`, `/admin/applications`, `/admin/businesses`).
  예약 전이 표에 `ADMIN` 자리가 생겼다(차단 시 확정 예약 취소 — 사유 필수)

마이그레이션은 **0008 그대로**. 이번 작업은 전부 기존 표(`shift_swap_requests`·`work_exceptions`·
`businesses`·`audit_logs`)를 쓴다. 새 의존성은 `sharp` 하나인데 아직 머지 전이다(PR #178).

## 막힌 것

**`main` 에 리뷰 반영분 2건이 빠져 있다.** #181 을 머지한 시점이 리뷰 수정 전이었다. 확인은 이렇게 한다 —
둘 다 `0` 이면 아직 안 들어간 것이다.

```bash
git show origin/main:src/features/booking/notify.ts   | grep -c reservationUrl    # #57 메일 링크
git show origin/main:src/features/schedule/swaps.ts   | grep -c assertPlanUsable  # #43 정원 판정
```

- **#57**: 메일 다섯 통이 `/me/reservations/{id}` 를 걸었는데 그 화면은 마이페이지 에픽(#87~#89)의 것이라
  아직 없다 — 손님이 누르면 404. 매장 공개 홈(`/@{slug}`)으로 바꾸고, 확정 메일에는 "바꾸거나 취소하려면
  매장으로 연락, 예약번호를 알려 주세요" 를 넣었다. 링크를 만드는 자리는 `notify.ts` 의 `reservationUrl` 하나다
- **#43**: 정원(`peakOccupancy`) 판정이 `pg_advisory_xact_lock` **밖**이라, 계획과 잠금 사이에 들어온 예약을
  못 보고 정원 초과 이관이 커밋될 수 있었다. 계획을 자물쇠 안에서 다시 돌리고 `assertPlanUsable` 로 두 판정을 묶었다

고친 커밋은 브랜치 `fix/review-followups` 에 체리픽 중이다(`6db8c0b`, `899b7a5`).

**`main` 브랜치 룰셋이 `Disabled` 다.** 커밋에서 회사 이메일을 지우느라 force-push 하려고 껐다. **Active 로 되돌릴 것.**

**운영 쪽 세 가지는 그대로다.** 손님 메일 발신 도메인 미검증(`MAIL_FROM` 이 Resend 샌드박스) · 카카오 로그인 없음 ·
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` 가 `majubom` vs `majubom-bb43e` 미확정. 셋 다 코드가 아니라 계정 작업이다(#12).

## 다음 한 수

1. **`fix/review-followups` 마무리** — `git cherry-pick 6db8c0b 899b7a5` 를 끝내고 PR. 본문에
   `Closes #43 / #44 / #45 / #46 / #57` 을 한 줄씩 넣는다. **#179·#180 을 머지 없이 닫으면 그 이슈들이
   안 닫히기 때문이다.**
2. **PR 정리** — #178(이미지 리사이즈, 리뷰 반영 완료)은 머지. #179·#180 은 내용이 `main` 에 들어갔으니
   닫고, 브랜치 `feat/7-booking-mail`·`feat/6-shift-swap`·`feat/9-admin-console` 삭제
3. **에픽 #9 나머지** — #67 사용량 집계(배치 03:00) · #68 감사 로그 조회 · #69 지표 대시보드.
   **#70 신고 처리는 못 한다** — 대상인 리뷰(#91)·채팅(#115)이 아직 없다
4. **에픽 #12 고객 마이페이지(#87~#89)** — 이게 붙으면 `notify.ts` 의 `reservationUrl` 을
   `/me/reservations/{id}` 로 되돌린다. 템플릿 다섯 통은 그대로다

**아직 정하지 못한 것은 전부 `LATER.md`.** 이번에 늘어난 것은 L-40(R2 리사이즈 방식 — 해소) ·
L-41(1기 게이트) · L-42(교대 요청 시점 경고) · L-43(교대 알림이 메일뿐)이다.
