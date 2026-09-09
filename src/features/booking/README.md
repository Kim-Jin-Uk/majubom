# 예약 엔진 (에픽 #7) — 설계 기록

정본은 `majubom-docs/02_기능명세서.md` §3.7 (FR-BOOK-010 ~ 070). 명세가 정하지 않은 것을 여기서 어떻게 정했는지만 적는다.
지금 있는 것은 **가용 슬롯 조회(FR-BOOK-010)** 까지다 — 예약 생성·상태 전이·취소·워크인은 다음 조각.

## 구조

```
features/booking/slot-types.ts    입력·출력 타입 (명세 엔티티의 투영). DB 행이 아니다
features/booking/time.ts          로컬 시각 ↔ 순간. 벽시계 기준, 오프셋의 정본은 Intl
features/booking/peak-occupancy.ts 순간 최대 동시 인원 (겹침 합산이 아니다)
features/booking/slots.ts         computeSlots — 순수 함수. DB·시계 없음
features/booking/context.ts       DB → SlotContext. 유일한 DB 접점
app/api/public/products/[id]/slots
```

## 결정한 것

**계산은 순수 함수, 적재는 따로.** `computeSlots(ctx, query)` 는 같은 입력이면 항상 같은 출력이다 — 테스트 40건(`tests/fixtures/slot-cases.json`)이
DB 없이 돌아가는 이유이고, 나중에 예약 생성이 트랜잭션 안에서 슬롯을 **재검증**할 때(FR-BOOK-020 3단계) 같은 함수를 그대로 부를 수 있는 이유다.
기대값은 구현보다 먼저 손으로 계산한 것이라, 결과가 다르면 구현을 고치기 전에 케이스의 `rationale` 줄을 먼저 검산한다.

**시간은 영업일 00:00 기준 분(minute)으로만 다룬다.** 자정을 넘긴 구간은 1440 을 넘는 분이다(익일 01:00 = 1500). 순간(epoch)으로는 마지막에 한 번만 바꾼다.
`time.ts` 의 변환은 **벽시계 기준** — "영업일 00:00 에서 1500분 뒤" 가 아니라 "다음 날 01:00" 이다. 서머타임이 있는 타임존에서 두 해석이 한 시간 어긋나는데
사람이 근무표에 적은 것은 벽시계 쪽이다. 없는 시각(봄, 02:30)은 건너뛴 뒤로 밀고, 두 번 있는 시각(가을, 01:30)은 먼저 온 쪽을 쓴다.

**우선순위 8단계는 `schedule/resolve.ts` 하나뿐이다.** STAFF 자원의 근무 구간은 근무표 에픽의 `resolveWorkDay` 를 그대로 부른다 — 여기에 두 번째 구현을 두지 않는다.
공간·공유 자원은 근무표가 없으므로 영업시간에서 휴무와 개인 차단(BLOCK)만 뺀다.

**승인되지 않은 휴가는 근무표가 아니다.** `context.ts` 는 `work_exceptions.status = 'APPROVED'` 만 싣는다. 사장님이 승인하기 전의 휴가 신청은
근무표에도, 슬롯에도 영향이 없다(근무표 에픽과 같은 규칙 — `applicable()`).

**버퍼는 점유에만 들어간다.** 구간 포함 판정(`[t, t+duration) ⊆ windows`)에는 버퍼를 넣지 않는다 — 명세 "버퍼는 운영 구간 밖으로 나갈 수 있다.
마감 20:00, 정리 버퍼 15분이면 19:00 시작 60분 예약이 성립한다". 다른 예약의 `occupyRange` 와는 겹칠 수 없고, 그건 `peakOccupancy` 가 본다.

**정원 1 은 팀 단위다.** `cap = min(capacityPerSlot, resource.capacity)` 가 1이면 한 팀이 슬롯을 통째로 쓰므로 잔여는 0/1 이고 인원과 비교하지 않는다.
명세 알고리즘의 `remaining ≥ partySize` 를 문자 그대로 적용하면 공간형 프리셋(정원 1 · 최대 4명)이 2명 이상 영원히 예약 불가가 된다(픽스처 가정 A1, `LATER.md` L-06).
정원 N 에서는 명세대로 인원 단위다.

**FIXED 회차 요일은 영업일 기준.** 화요일 20:00~02:00 영업의 `{dow:2, times:["01:00"]}` 은 수요일 새벽 1시다 — 자정을 넘겨 영업하는 날의 이른 시각은 익일로 읽는다.
제외 사유 판정 순서는 `OUT_OF_WINDOW → LEAD_TIME → FULL` (가정 A9). 구간이 비어도 그날 정의된 회차는 전부 열거한다 — 위젯이 "운영 시간 외" 를 보여줘야 한다.
FREE 는 후보가 구간 안에서 만들어지므로 `excluded` 를 쓰지 않는다.

**날짜 범위 밖은 오류가 아니라 빈 결과.** `today ≤ date ≤ today + maxAdvanceDays`. `today` 는 사업장 타임존 기준이라 한국 새벽에 UTC 로 세면 하루 어긋난다.

## API

`GET /api/public/products/:id/slots?date=YYYY-MM-DD[&to=][&partySize=1][&durationMin=][&resourceId=]`
하루 또는 기간(최대 31일). 기간이어도 DB 는 한 번만 읽고(`loadSlotContext`) 날짜별로 순수 함수를 돌린다 — 명세의 N+1 금지·반복 휴무 메모리 전개.
입력 검증 실패(`DURATION_NOT_ALLOWED` · `PARTY_SIZE_EXCEEDED` · `PARTY_SIZE_INVALID` · `RESOURCE_REQUIRED`)는 400. `RESOURCE_NOT_LINKED` 와 비공개 상품·미승인 사업장은 404 — 남의 자원·상품은 존재를 알리지 않는다.
`resourceSelectMode=AUTO` 면 응답에서 `resourceIds` 를 지운다 — 배정은 서버가 하고 고객에게는 보이지 않는다(FR-PRD-010). 함수 결과에는 담겨 있어 예약 생성이 쓴다(가정 A6).
결과는 `Cache-Control: no-store` 다. 명세의 캐시는 "필터 전 원본"(구간·점유)에만 붙이는 것이라 최종 슬롯 목록은 캐시하지 않는다.

## 아직 안 한 것 (의도적으로)

결정이 아직 안 된 것(슬롯 계산 가정 A1~A11 을 명세로 올릴지 · 합산 잔여의 의미)은 루트 `LATER.md` — L-06·L-31.

- 예약 생성(FR-BOOK-020) · 승인/거절 · 취소 · 변경 · 워크인 — 이 에픽의 다음 조각들
- 슬롯 캐시 — 키(`win:{businessId}:{resourceId}:{date}` · `occ:…`)와 무효화 트리거·TTL 60초는 명세가 이미 정해 뒀다. 캐시 없이 먼저 만들고 느려지면 붙인다
- `AUTO` 배정 후보 정렬(FR-BOOK-020 3.5) — 지금은 `resourceIds` 를 sortOrder 로 담아만 둔다 (가정 A6)
- 예약 위젯·공개 홈(에픽 #10·#11)이 이 API 를 쓴다. 지금은 API 만 있고 화면이 없다
