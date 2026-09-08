# tests/fixtures — 슬롯 계산 테스트 케이스

## slot-cases.json

`FR-BOOK-010 가용 슬롯 조회`(`reservation-docs/02_기능명세서.md` §3.7)의 입력·기대출력 40건.
구현(이슈 7-1·7-2)보다 먼저 작성됐고, 기대값은 **명세를 손으로 따라가 계산한 값**이다.
케이스마다 `rationale`에 한 줄 계산 근거가 있으니 구현과 결과가 다르면 먼저 그 줄을 검산한다.

- 타입: `src/features/booking/slot-types.ts` (`SlotContext`, `SlotQuery`, `SlotResult`)
- 스키마 검증: `tests/unit/slot-fixture.schema.ts` (zod) — `tests/unit/slot-calc.test.ts`가 매 실행마다 검증
- 타임존: 모든 케이스 `Asia/Seoul`, 모든 시각은 `+09:00` 오프셋을 가진 ISO 8601

### 케이스 형식

```jsonc
{
  "id": "S01",                 // S + 두 자리, 파일 내 유일, 오름차순
  "title": "…",                // 한 줄 요약. 가정에 의존하면 "[가정 A1]" 처럼 표기
  "tags": ["free", "staff"],   // 아래 태그 어휘에서만
  "rationale": "…",            // 기대값을 어떻게 손으로 계산했는지 한 줄
  "ctx":   { /* SlotContext */ },
  "query": { /* SlotQuery   */ },
  "expected": { "slots": [...], "excluded": [...] }   // 또는 { "error": "DURATION_NOT_ALLOWED" }
}
```

### 태그 어휘

| 태그 | 뜻 | 최소 건수 |
|---|---|:---:|
| `free` | `startMode=FREE` 격자 생성 | — |
| `fixed` | `startMode=FIXED` 회차. `expected.excluded` 필수(빈 배열 허용) | 6 |
| `staff` / `space` / `shared` | 자원 타입 | shared 4 |
| `midnight` | `close ≤ open`, `endTime ≤ startTime` 익일 해석, 영업일 요일 회차 | 5 |
| `buffer` | `bufferBeforeMin`/`bufferAfterMin`이 결과에 영향 | 5 |
| `capacity-1` | 정원 1 자원 — 스윕라인 = 겹침 검사 | — |
| `capacity-n` | 정원 N, `peakOccupancy` 순간 최대 동시 인원 (명세 20석 예시 S10·S11 포함) | 5 |
| `closure` | Holiday · WorkSchedule · WorkException · 휴게시간으로 구간이 줄어듦 | 5 |
| `duration-options` | `durationOptions` 선택 / 기본값 / 목록 밖 오류 | 3 |
| `resource-assign` | 자원 무관 조회 합산(`mergeByStartTime`), AUTO, REQUIRED, `resourceId` 지정 | 3 |
| `boundary` | `minLeadTimeMin`, `maxAdvanceDays`, 마감 직전, 인원 상한 등 경계값 | 4 |
| `status` | 예약 상태별 점유 여부 | — |
| `error` | `expected.error` 케이스. 오류 케이스는 반드시 이 태그를, 이 태그는 반드시 오류 케이스여야 한다 | — |

최소 건수는 `tests/unit/slot-calc.test.ts`의 `MIN_TAG_COUNT`가 검사한다. 새 태그는 `slot-fixture.schema.ts`의 `caseTag`와 이 표에 함께 추가한다.

### 공통 픽스처 (케이스 대부분이 공유)

| 이름 | 내용 |
|---|---|
| 영업일 `D` | `2026-10-01` 목요일(dow 4). 화요일 케이스는 `2026-10-06`, 금요일은 `2026-10-02` |
| `now` 기본 | `2026-09-30T09:00:00+09:00` — 선행시간·날짜 범위가 결과에 영향 없도록 하루 전. 경계 케이스만 바꾼다 |
| 정책 | `minLeadTimeMin 60`, `maxAdvanceDays 30` |
| 영업시간 | 표준 월~토 10:00–20:00 / 휴게 13:00–14:00 변형 / 심야 화~토 20:00–02:00 / 24시간 00:00–00:00 |
| 담당자 근무 | 월~금 10:00–19:00, 휴게 13:00–14:00 |
| 상품 | 담당자형 `prd-nail`(FREE·90분·30분·정원1·OPTIONAL) / 공간형 `prd-room`(FREE·60/120/240·정원1·REQUIRED·최대4명) / 수업형 `prd-yoga`(FIXED 화·목 10·13·16·20시·60분·정원15·NONE) / 공유 데스크 `prd-desk`(FREE·60/120/240·정원20) |

### 새 케이스 추가 규칙

1. **명세를 먼저 읽고 손으로 계산한다.** 구현을 돌려 나온 값을 기대값으로 붙이지 않는다 — 그러면 테스트가 구현을 검증하지 못한다.
2. `rationale`에 계산 과정을 한 줄로 적는다. "후보 N개 − 제외 M개 = K개"처럼 검산 가능한 형태로.
3. `id`는 마지막 번호 + 1. 중간 삽입·번호 재배열 금지 (이슈·PR 코멘트가 id로 케이스를 가리킨다).
4. 기존 공통 픽스처를 재사용하고, 케이스가 보려는 것 **하나만** 바꾼다. 여러 요인이 동시에 바뀌면 실패 시 원인을 못 찾는다.
5. `expected.slots`는 `start` 오름차순, 시작 시각 중복 없음(자원 무관 조회는 합산됨). 슬롯 길이 = `query.durationMin ?? product.durationMin`.
6. FIXED 상품은 `expected.excluded`를 반드시 채운다(제외 회차 없으면 `[]`). `reason=FULL`이면 `remaining`(partySize 미만)을 함께 적는다. FREE 상품은 `excluded`를 쓰지 않는다.
7. 명세 해석이 갈리는 지점에 의존하면 아래 "가정" 목록에 번호를 추가하고 `title`·`rationale`에 `[가정 An]`으로 표기한다.
8. 케이스 수를 바꾸면 `slot-calc.test.ts`의 `toHaveLength(40)`도 함께 바꾼다 (의도적 변경임을 리뷰에서 드러내기 위해 상수로 두지 않았다).
9. `npx vitest run tests/unit` 으로 스키마·태그·정렬 검사를 통과시킨 뒤 커밋한다.

### 명세 해석 가정 (구현 시 반드시 재확인)

FR-BOOK-010 본문만으로 결정되지 않아 픽스처가 택한 해석. 명세가 개정되면 해당 케이스의 기대값을 바꾼다.

| # | 가정 | 근거·영향 | 케이스 |
|---|---|---|---|
| **A1** | **정원 1 슬롯(`min(capacityPerSlot, capacity) = 1`)은 팀 단위 점유다.** `remaining`은 0/1이고 `partySize`와 비교하지 않는다. `partySize`는 `maxPartySize`로만 제한한다 | 명세 알고리즘 `remaining ≥ partySize`를 문자 그대로 적용하면 공간형 프리셋(정원 1, 최대 4명)은 2명 이상 **영원히 예약 불가**. FR-SITE-020의 "인원 상한 = min(maxPartySize, remaining)"도 같은 모순. 정원 N에서는 명세대로 인원 단위 | S09 S23 S24 S35 S40 |
| A2 | `ceilToInterval`은 로컬 시계 00:00을 기준으로 정렬한 격자다(10:05 오픈·30분 → 10:30) | 명세는 정렬 기준을 말하지 않음. 픽스처는 모두 정각 오픈이라 결과 영향 없음 | — |
| A3 | `partySize > maxPartySize`는 슬롯 조회에서도 `PARTY_SIZE_EXCEEDED` 오류다 | FR-BOOK-020 1단계에만 명시. 순수 함수도 같은 검증을 하는 편이 안전 | S34 |
| A4 | `WorkException MODIFIED`는 그날 주간 패턴을 **휴게 포함** 통째로 대체한다. `EXTRA`는 (OFF가 없으면) 패턴에 **추가**된다. `WorkSchedule.breaks`는 FIXED 상품에서도 차감한다(`fixedIgnoreBreaks`는 영업시간 브레이크에만) | FR-SCH-020 우선순위 표는 순서만 정하고 결합 방식은 OFF+EXTRA만 설명 | S31 S32 |
| A5 | `resourceSelectMode=REQUIRED`에 `query.resourceId`가 없으면 `RESOURCE_REQUIRED` 오류 | FR-SITE-020: REQUIRED는 [1]단계에서 공간을 고른 뒤 조회. 합산 결과를 주는 대안도 가능 | S39 |
| A6 | `AUTO`에서도 함수 결과의 `resourceIds`는 채운다. 고객 미노출은 API 계층 책임 | 배정 후보 정렬(FR-BOOK-020 3.5)에 필요 | S38 |
| **A7** | 날짜 범위 0단계는 문자 그대로 `today = (now AT TIME ZONE tz)::date`. 심야 영업 중 자정이 지나면 **그 영업일은 `date < today`가 되어 빈 결과** | 20:00~02:00 영업에서 00:10에 01:00 슬롯을 예약할 수 없다. 의도라면 유지, 아니라면 "영업 중인 전 영업일은 허용"으로 명세 보강 필요 | S28 |
| A8 | 반복 휴무·근무예외는 **영업일 `date`** 기준으로 매칭한다. 전일 휴무는 익일로 넘어가는 구간까지 통째로 차단 | 시간 규약 "모든 time은 영업일 기준" 확장 | S27 S29 |
| A9 | FIXED에서 `excluded`는 구간이 비어도(휴무 등) 그날 정의된 회차마다 `OUT_OF_WINDOW`로 열거한다. 판정 순서는 OUT_OF_WINDOW → LEAD_TIME → FULL | 알고리즘은 `windows is empty: continue`지만 위젯이 "운영 시간 외"를 보여줘야 함 | S16~S22 |
| A10 | `durationOptions`가 없는 상품에 `query.durationMin`이 와도 무시하고 `product.durationMin`을 쓴다 | 명세 의사코드 `durationOptions ? assertIn : product.durationMin` 문자 그대로 | — |
| A11 | 입력 검증 실패는 throw가 아니라 `{ error }` 반환. API 계층이 400으로 매핑 | 순수 함수 테스트 용이성 | S34 S36 S39 |
