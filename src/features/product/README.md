# 예약 상품 콘솔 (에픽 #31) — 설계 기록

정본은 `02_기능명세서.md` §3.4 (FR-PRD-010 ~ 030) 와 기획서 4.1 (자원과 상품, 세 스위치). 명세가 정하지 않은 것을 여기서 어떻게 정했는지만 적는다.

## 구조

```
features/product/schema.ts    입력 모양 (zod) — 세 스위치의 조합 규칙: FREE↔slotInterval, FIXED↔fixedStartTimes, FIXED+durationOptions 불가, 회차 겹침, 1건 인원 ≤ 정원
features/product/presets.ts   프리셋 3종(담당자형·공간형·수업형) — 초기값일 뿐 잠금이 아니다
features/product/products.ts  DB 에 기대는 규칙: 자원 소속·활성, STAFF+SHARED 혼합 금지, 정원 ≤ 자원 정원(400), 소요시간 ≤ 영업시간, 회차 warnings, 수정 영향 확인, 삭제→보관
features/product/ui/          ProductForm(등록·수정·매니저 제한 편집) · ProductsPanel(목록·상태·순서·삭제)
app/api/console/products/*    GET/POST · [id] GET/PUT/DELETE · [id]/status · reorder
app/console/products/*        목록 · new · [id]. 위저드 3단계는 상품이 없으면 폼, 있으면 목록
lib/upload-client.ts          presign → 브라우저가 R2 에 직접 PUT. R2 미설정(로컬)이면 URL 직접 입력으로 안내
```

## 결정한 것

**정원 1 은 팀 단위, 정원 N 은 좌석 단위.** 공간형 프리셋의 "정원 1 · 1건 최대 4명" 은 모순이 아니다 — 정원 1 은 한 팀이 슬롯(방·담당자)을 통째로 쓴다는 뜻이고
4명은 그 팀의 인원 상한이다(예약 엔진 가정 A1, `tests/fixtures/README.md`). 그래서 "1건 인원 ≤ 정원" 검사는 정원이 2 이상일 때만 건다. 정원을 1 로 내릴 때의
기존 예약 검사도 인원 합이 아니라 겹치는 예약 **건수**로 한다.


**검증은 두 층.** 입력 자체의 모양(schema.ts)은 DB 없이 검사해서 테스트하기 쉽고 클라이언트 번들에 들어가도 된다(`business/hours.ts` 만 의존).
다른 데이터에 기대는 규칙(자원 정원·영업시간·미래 예약)은 products.ts 가 트랜잭션 안에서 본다. 둘 다 400 `INVALID_BODY` + `issues[path]` 로 답해 폼이 필드에 붙인다.

**정원은 조용히 줄이지 않는다.** `capacityPerSlot` 이 연결 자원의 최소 정원보다 크면 400 (`fields:[capacityPerSlot]`). 명세의 이유 그대로 —
15명 수업을 등록했다고 믿는데 실제로는 1명만 받는 사고를 막는다.

**영업시간 밖 회차는 저장하되 알린다.** 각 회차를 `[t, t+duration)` 전체로 그 요일의 영업 구간(브레이크 무시 = `fixedIgnoreBreaks` 기본 true, 컬럼은 아직 없어
항상 true)과 비교해 `warnings[{dow,time,reason}]` 로 돌려준다. 등록 직후 경고가 있으면 수정 화면으로 보내 "이 회차는 예약 페이지에 표시되지 않습니다" 를 보인다.
조용히 사라지면 사업자가 이유를 모른다. 영업시간이 아직 없으면(1단계 전) 소요시간 검사는 건너뛴다.

**예약 형태 변경은 확인을 받는다.** `startMode·fixedStartTimes·slotIntervalMin·durationMin·durationOptions·버퍼·capacityPerSlot·담당 자원` 이 바뀌고 미래
REQUESTED/CONFIRMED 예약이 있으면 `confirmAffected` 없이는 409 `AFFECTS_RESERVATIONS {count}` — 폼이 "기존 예약 N건은 예약 당시 설정을 유지합니다" 로 묻고 다시 보낸다.
거부(400)되는 것 둘: 정원을 미래 예약의 **순간 최대 동시 인원**보다 낮게 / 미래 예약이 있는 자원의 연결 해제. 기존 예약 행의 스냅샷은 건드리지 않는다.
동시 인원은 `features/booking/peak-occupancy.ts` 의 `peakOccupancy`(FR-BOOK-010 스윕라인)를 자원별로 돌려 구한다 — 같은 start_at 합산은 이용 시간이 다른 예약의 부분 겹침을 놓친다
(10:00~11:00 3명 + 10:30~12:00 2명 = 순간 5명). 예약 엔진과 같은 함수를 쓰므로 두 계산이 어긋나지 않는다.
이미 연결된 자원이 비활성이 됐어도 유지는 허용한다(새로 연결만 막는다) — 아니면 예약이 남은 비활성 자원 때문에 상품이 영영 수정 불가가 된다.

**매니저의 수정은 다른 스키마로 받는다.** `editProduct` 권한 + 본인 계정이 연결된 STAFF 자원이 담당인 상품에 한해 `productLimitedInputSchema`(설명·사진·ACTIVE↔HIDDEN).
같은 PUT 엔드포인트에서 역할로 스키마를 가른다 — 매니저가 전체 스키마를 보내도 알려지지 않은 키는 버려진다. DRAFT 공개·ARCHIVED 복구는 OWNER 만.

**삭제는 보관이다.** 예약 이력이 하나라도 있으면 `ARCHIVED`(목록·공개 페이지에서 숨김, 과거 예약·리뷰의 참조 유지). 예약이 전혀 없는 상품만 물리 삭제. 둘 다 `PRODUCT_DELETE` 감사.

**위저드의 첫 상품은 ACTIVE 로 시작한다.** 이 단계의 목적이 공개 조건(활성 상품 ≥ 1)을 채우는 것이고, 홈페이지는 승인 전엔 어차피 열리지 않는다. 콘솔에서 만드는 상품은 DRAFT.

**#155 에서 넘어온 버그 수정.** `loadConsoleBusiness` 의 스칼라 서브쿼리가 `${businesses.id}` 를 썼는데 drizzle 은 단일 테이블 select 에서 이를 `"id"` 로만 렌더링해
서브쿼리 안에서 `r.id` 로 잡혔다 — 공개 조건의 자원·상품 수가 늘 0 이었다. 테이블명을 글자로 쓴다.

**사진 URL 은 http(s) 면 무엇이든 저장된다.** 업로드 경로는 R2 공개 URL 만 만들지만, 폼은 임의 URL 입력도 받는다(로컬·마이그레이션 편의). 사업자 본인의 상품 사진이라
피해자가 자기 자신뿐이고, 공개 페이지(#71)에서는 `next/image` 의 `remotePatterns` 로 R2 도메인만 최적화·서빙하도록 좁힐 예정.

## 아직 안 한 것 (의도적으로)

결정이 아직 안 된 것(`fixedIgnoreBreaks` 노출·사진 URL 출처)은 루트 `LATER.md` — L-16·L-17.

- 이미지 정렬은 "앞으로" 버튼(드래그 아님). 업로드 실패 시 URL 직접 입력은 개발 편의 — 프로덕션에서는 R2 가 있어 잘 보이지 않는다
- 자원별 회차(같은 상품, 자원마다 다른 시간표) — 근무표(#37)가 STAFF 가용 시간을 정했으니 예약 엔진이 자원별로 계산한다. 상품 쪽 설정은 필요해지면
- 상품 복제·일괄 상태 변경·검색 — 상품이 열 개를 넘는 사업장이 생길 때
