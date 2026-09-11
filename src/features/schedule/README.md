# 휴무일 · 근무표 콘솔 (에픽 #37) — 설계 기록

정본은 `02_기능명세서.md` §3.5 (FR-SCH-010 ~ 040). 명세가 정하지 않은 것을 여기서 어떻게 정했는지만 적는다.

## 구조

```
features/schedule/resolve.ts         하루의 근무 구간 결정 — 순수 함수. 우선순위 8단계를 구현한 유일한 곳. 슬롯 엔진(FR-BOOK-010)도 이걸 쓴다
features/schedule/holidays.ts        휴무 규칙 CRUD · 발생일 전개 · 미래 예약 충돌
features/schedule/work-schedules.ts  주간 패턴 — 버전(effectiveFrom/To) · 일괄 적용 · EXCLUDE 제약과의 순서
features/schedule/work-exceptions.ts 일자별 예외 — 사라지는 근무 구간의 예약 충돌 · 매니저 BLOCK 권한 · 휴가 신청(PENDING) 승인·반려
features/schedule/calendar.ts        자원 × 날짜 그리드 + 요약 지표 (화면은 계산하지 않는다)
features/schedule/ui/                ScheduleGrid(주간 그리드·예외 등록) · PatternEditor · HolidaysPanel · SwapsPanel
app/api/console/{holidays,work-schedules,work-exceptions(+[id]/decide),schedule,swaps(+[id])}
app/api/cron/expire-swaps          C8 — 72시간 무응답 만료
app/console/{schedule, schedule/pattern, schedule/swaps, holidays}
```

## 결정한 것

**우선순위는 "바탕을 정하고 깎는다".** 명세의 1~8 을 그대로 if 사슬로 쓰면 OFF+EXTRA 공존 같은 조합이 어긋난다. `resolveWorkDay` 는
바탕(MODIFIED 구간 > OFF=빈 구간 > WorkSchedule−휴게) 에 EXTRA 를 더하고, BLOCK → 자원 휴무 → 사업장 휴무 순으로 뺀다. 결과적으로 명세 표와 같다:
휴무는 무조건 차단, EXTRA 는 OFF 를 이기고, BLOCK 은 어떤 근무든 깎는다. 테스트(`resolve.test.ts`)가 각 순위를 하나씩 고정한다.
예약 가능(bookable) = 근무 ∩ 영업시간(휴게 제외). 영업 밖 근무는 저장되지만 예약이 열리지 않는다(명세).

**패턴은 덮어쓰지 않고 버전을 만든다.** 적용 시작일은 오늘 이후만(과거부터 적용하면 지난 날을 다스린 버전이 지워진다). 자원 행을 `FOR UPDATE` 로 잠가 동시 저장을 직렬화하고, 그래도 EXCLUDE 에 걸리면 23P01 → 409.
대체된 예정 패턴 수(`replacedUpcoming`)를 돌려줘 일괄 적용 때 다른 담당자의 예정 패턴이 지워졌음을 알린다. 새 패턴을 `effectiveFrom` 부터 적용하면 그 자원·요일의 열린 행은 `effectiveTo = from − 1` 로 닫고(이력),
from 이후에 시작하는 행은 지운다(닫으면 뒤집힌 기간이 된다). 순서를 지키면 EXCLUDE 제약(`work_schedule_no_overlap`)에 걸리지 않고, 경합으로 걸리면 409.
요일 하나의 근무는 한 구간(시작<끝, DB CHECK — 자정 넘김은 아직) + 휴게 2구간. 일괄 편집은 같은 입력을 자원 여러 개에 반복하는 것.

**충돌은 "사라지는 근무 구간의 예약" 으로 정의한다.** 그날을 예외 전·후로 두 번 계산해 차이를 구한다(`resolve(before) − resolve(after)`) — 살아남는 EXTRA 구간을
잘못 충돌로 잡지 않는다. BLOCK 만은 명세(FR-SCH-040) 그대로 구간 자체를 본다. 같은 날 OFF·MODIFIED 는 하나만(409 `EXCEPTION_EXISTS`) — 둘이면 어느 것이 적용되는지 정의되지 않는다.
휴무는 발생일(반복이면 앞으로 365일 — maxAdvanceDays 상한)의 예약 — 부분 휴무는 시간 겹침만. 전날 저녁에 시작해 자정을 넘긴 예약도 그 날짜의 충돌로 본다 — 시간 비교는 그 날짜의 분 좌표로 옮겨서(종료일에서는 `[0, endMin)`), 정확히 00:00 에 끝나면 종료일은 차지하지 않는다. 충돌이 있으면 409 로 목록을 돌려주고 OWNER 만 `confirmConflicts`/`keepReservations` 로
강행한다(예약은 그대로 남고 새 예약만 막힌다). 명세의 "일괄 취소 + 고객 알림" 은 예약 콘솔 에픽에서 취소·알림이 생기면 붙인다 — 여기서 조용히 취소하지 않는다.

**매니저: 차단은 바로, 휴가는 신청.** 계정이 연결된 STAFF 자원(`resources.member_id`)에 한해. `kind=BLOCK` 은 바로 적용되되 그 시간에 예약이 있으면 등록 불가(FR-SCH-040).
휴가(`leave: true`)는 종일이면 OFF, 시간 단위면 BLOCK 으로 **PENDING** 상태로 들어가고, 사장님이 `POST …/work-exceptions/:id/decide` 로 승인(APPROVED)해야 근무표에 반영된다.
근무표 계산(`resolveWorkDay` 에 넘기는 목록)은 **APPROVED 만** — `applicable()`. 승인은 등록과 같은 충돌 검사를 거친다(그 사이 예약이 생길 수 있으니 신청 시점이 아니라 승인 시점에).
반려(REJECTED)는 반려 사유와 함께 신청자·OWNER 에게만 보이고, 신청자가 지울 수 있다. 신청자는 대기 중 신청을 취소할 수 있지만 승인된 휴무는 사장님만 되돌린다(차단은 본인이 지운다).
같은 날 OFF 중복 검사는 승인·대기 중인 것만 본다(반려된 뒤 다시 신청할 수 있다). 사장님이 직접 두는 예외는 늘 APPROVED — 사장님에게 `leave` 는 무시.
`status` 컬럼 기본값이 APPROVED 라 기존 행은 전부 적용 중인 예외다(0003). 승인·반려는 감사 로그 `LEAVE_APPROVE`/`LEAVE_DENY`(0004).
시간 변경·추가 근무 요청은 교대 에픽(#43)의 흐름으로. `reason`·반려 사유는 본인과 OWNER 만 본다 — 조회 함수가 다른 사람의 것을 null 로 가린다(FR-SCH-030).

**결과·오류는 토스트.** 예외 폼이 그리드 아래에 있어 위쪽 Alert 는 안 보였다 — `components/ui/Toast` (화면 아래 가운데, 오류 8초·그 외 6초, role=alert/status).
`EXCEPTION_EXISTS`·`MANAGER_BLOCK_ONLY`·`NOT_PENDING` 은 코드가 아니라 사람 말로.

**날짜는 사업장 타임존의 오늘.** 서버 시계는 UTC 라 한국 새벽엔 하루 어긋난다 — `lib/dates.ts` `todayIn(tz)`. 예약을 날짜별로 셀 때는
`start_at at time zone <tz>` 로 로컬 날짜를 구하고, **자정을 넘겨 끝나는 예약은 종료일 셀에도 넣는다** (휴무 충돌 `reservationsOnDates` 와 같은 기준). 집계는 SQL GROUP BY 대신
행을 받아 JS 에서 센다 — 같은 식이 SELECT 와 GROUP BY 에 다른 `$n` 으로 바인딩되면 PG 가 같은 식으로 보지 않는 함정도 피한다.

**요약 지표.** 근무일 수·총 근무시간(휴게·BLOCK·휴무 차감 후)·휴무일 수(영업일인데 근무 0)·예정 예약 건수(시작일 또는 종료일이 기간에 드는 예약, 중복 없이) — 요청 기간(주) 기준. 월간은 기간을 넘겨 부르면 된다(최대 62일).

## 근무 교대 (FR-SHIFT-010~030, #43~#46)

**판정의 정본은 자물쇠 안의 재계산이다.** 계획(`planSwap`)을 두 번 돌린다 — 한 번은 트랜잭션 밖에서
"사람에게 물어봐야 하는 것"(담당자 직접 지정 확인)을 자물쇠를 쥔 채 묻지 않기 위해서, 한 번은
`pg_advisory_xact_lock` 을 잡은 뒤에 **다시**. 바깥 계산과 잠금 사이에 새 예약이 들어오면 정원 N 자원의
`peakOccupancy` 가 그만큼 낮게 나와 정원 초과 이관이 커밋될 수 있다. 예약 생성(`create.ts`)도 같은 키
(`hashtext(resource_id::text)`)를 잡으므로, 자물쇠 뒤로는 두 자원에 새 예약이 끼어들 수 없다.
두 번의 판정은 `assertPlanUsable` 한 함수를 쓴다 — 갈라지면 "미리보기는 통과했는데 반영에서 다른 이유로 막히는" 조합이 생긴다.

**근무표를 바꾸기 전에 예약을 전부 판정한다.** 이 에픽의 위험은 하나뿐이다 — 근무만 넘어가고 예약은 원래 사람에게 남으면
그날 손님이 빈 가게에 온다(기획서 리스크 R4). 그래서 `planSwap` 이 **트랜잭션 밖에서** 만들 예외·옮길 예약·막는 이유를 다 구하고,
하나라도 막히면 상태를 건드리지 않는다. 트랜잭션 안에서도 이관 UPDATE 가 0행이면(그 사이 취소됐다) 통째로 되돌린다.

**방향은 `swap-rules.ts` 가 푼다.** GIVE 는 한 방향, EXCHANGE 는 두 방향이고 이관 여부는 방향마다 따로다(`reassignRequester`/`reassignTarget`).
분해를 승인 로직 안에 풀어 두면 맞교대의 반대 방향이 조용히 빠진다. 전이 표도 같은 파일에 있다 — 라우트가 각자 조건을 들면 곧 어긋난다.

**EXTRA 는 대신 서는 쪽의 그 날짜에 만든다.** 명세 3단계 주석 그대로다. 넘기는 쪽에는 OFF 를 두고, "유지" 를 고르면 그 위에
예약 시간만 EXTRA 를 얹는다 — `resolve.ts` 의 4·5순위(EXTRA 가 OFF 를 이긴다)가 바로 이 조합을 위한 것이다.

**요청은 본인 자원에서만 낸다 — 사장님도.** 교대의 전제가 당사자 간 동의인데 사장님이 남의 이름으로 요청을 내면 "수락" 이 동의가 아니게 되고,
사장님은 근무 예외로 근무표를 직접 고칠 수 있다. 대신 사장님은 모든 요청을 보고 승인·거부한다(`shiftAutoApprove=false` 일 때).

**같은 두 사람·같은 날은 진행 중인 요청 하나뿐.** 방향은 따지지 않는다 — "가→나" 와 "나→가" 가 같은 날 함께 열려 있으면
둘 다 승인됐을 때 근무표가 제자리로 돌아온다.

**승인 직전에 다시 본다.** 요청부터 승인까지 최대 72시간이 비어 있어 그 사이 새 예약이 들어올 수 있다.
`reservationIdsAtRequest` 스냅샷과 재조회 결과가 다르면 409 `SWAP_RESERVATIONS_CHANGED` — 사람이 다시 보기 전에는 반영하지 않는다.
고객이 담당자를 직접 고른 상품(`resourceSelectMode=REQUIRED`)의 예약을 옮길 때는 409 `SWAP_DIRECT_PICKS` 로 확인을 한 번 더 받는다.

**자정을 넘긴 근무는 아직 교대할 수 없다** (409 `SHIFT_CROSSES_MIDNIGHT`). `work_exceptions` 의 CHECK 가 `start < end` 인 하루 안의
구간만 담아서, 넘겨줄 근무 시간을 적을 자리가 없다. 주간 패턴이 자정 넘김을 받게 되는 날 같이 푼다 (L-12).

## 아직 안 한 것 (의도적으로)

결정이 아직 안 된 것(휴무 일괄 취소 정책·자정 넘김 근무·YEARLY 말일·알림)은 루트 `LATER.md` — L-11·L-12·L-13·L-14.

- 월간 캘린더 뷰 · 모바일 리스트 뷰 (지금은 주간 표 + 가로 스크롤). "이번 달 근무일 수" 는 API 로 62일까지 조회 가능
- 휴무 규칙 수정 (지금은 삭제 후 재등록), 공휴일 자동 등록
