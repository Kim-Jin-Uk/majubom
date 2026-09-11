# 마주,봄

소규모 사업장을 위한 예약 SaaS. 업종에 상관없이 **"자원의 시간 구간을 정원 안에서 점유한다"** 는
하나의 스키마로 담당자형·공간형·수업형 예약을 모두 처리한다.

## 문서

기획서·기능명세서·ERD·스택 산정·코드 관리 전략은 **별도 private 저장소 [`majubom-docs`](https://github.com/Kim-Jin-Uk/majubom-docs)** 에 있다.
사업 계획·지표·비용이 들어 있어 코드와 분리했다. 문서가 서로 어긋나면 `02_기능명세서.md`가 정본이다.

## 스택

- **Next.js 16 (App Router, Turbopack)** · TypeScript · React 19 · Drizzle ORM
- **PostgreSQL (Neon)** — 예약 엔진. `EXCLUDE USING gist`로 이중 예약을 DB가 물리적으로 거부
- **Firestore** — 채팅만. 보안 규칙으로 인가
- **Firebase App Hosting** — 배포 (Blaze 종량제 필수)
- **FCM** · Resend · Cloudflare R2 · Sentry

## 로컬 실행

```bash
cp .env.example .env.local     # DATABASE_URL 둘은 필수, 나머지는 필요할 때
npm ci
npm run db:migrate             # 또는 npm run db:reset (1기 전용 — 스키마 초기화 후 재적용)
npm run db:check               # 스키마 불변 제약 9종 확인
npm run dev
```

로컬 Postgres는 16 이상. `CREATE EXTENSION btree_gist` 권한이 있는 역할이어야 한다 (첫 마이그레이션이 확장을 만든다).

**Node 22 + npm 11** (`npm install -g npm@11`). Node 22 내장 npm 10.9 는 vitest 4.1 의 lockfile 을 처리하지 못해 `npm ci` 가 `edgesOut` 오류나 "lock file out of sync" 로 실패한다. `engines.npm` 에 명시돼 있고 CI·App Hosting 빌드도 같은 버전을 쓴다.

| 명령 | 하는 일 |
|---|---|
| `npm run verify` | typecheck + lint + test — **push 전에 한 번** |
| `npm test` | vitest 유닛 (슬롯 계산 40건 포함 — FR-BOOK-010 구현 완료) |
| `npm run test:rules:emu` | Firestore 보안 규칙 테스트 (에뮬레이터 기동 포함, Java 필요) |
| `npm run db:generate` | 스키마 변경 → 마이그레이션 SQL 생성 |
| `npm run db:migrate` | 마이그레이션 적용 (직결 연결 · `lock_timeout 3s` · 재시도) |
| `npm run db:check` | 불변 제약 검사 — CI `verify` 잡에서도 돈다 |
| `npm run db:status` | 배포된 DB 가 이 브랜치와 같은 자리인지 (읽기 전용 — 프로덕션에 그대로 돌린다) |
| `npm run admin:promote -- <email>` | 있는 사용자를 ADMIN 으로 승격 |
| `ADMIN_PASSWORD='…' npm run admin:create -- <email> ["이름"]` | ADMIN 계정 생성(없으면) 또는 승격(있으면). 비밀번호는 **환경변수로만** 받는다 — 명령행 인자는 셸 히스토리와 `ps` 에 남는다. 둘 다 첫 `/admin` 진입에서 TOTP 등록이 강제된다 |
| `npm run job:cleanup-unverified` | 7일 지난 미검증 사업자 신청 삭제 (프로덕션은 Cloud Scheduler → `/api/cron/cleanup-unverified`) |
| `npm run job:reservations` | 예약 배치 둘(만료·자동 노쇼)을 로컬에서 한 번 돌린다 |

### 운영: 마이그레이션과 배치

**마이그레이션은 배포보다 먼저다.** enum 값 추가(0004·0005)는 새 코드가 이미 쓰는 값이라, 순서가 반대면 감사 로그 쓰기가 그 자리에서 실패한다.
`npm run db:migrate` 는 이미 적용된 것을 건너뛰므로 여러 번 돌려도 된다. 끝나면 두 가지를 확인한다 —
`npm run db:check` 는 이중 예약 방어선(EXCLUDE·CHECK)이 살아 있는지, `npm run db:status` 는 마이그레이션이 어디까지 갔는지 본다.
둘이 겹치지 않는다: enum 값이 빠져 있으면 제약은 멀쩡한데 감사 로그 쓰기만 런타임에 죽어서 `db:check` 로는 안 잡힌다.
직결(unpooled) 주소가 필요하다 — 러너가 pooled 주소를 거부한다(Neon PgBouncer 는 `SET lock_timeout` 을 못 받는다).

**배치 넷은 Cloud Scheduler 가 친다.** 인증은 헤더 `X-Cron-Secret: $CRON_SECRET` 하나뿐이고, 틀리면 404 다(엔드포인트 존재를 숨긴다).
`Authorization: Bearer` 가 아니다. 프록시의 Basic Auth 게이트는 `/api/cron/*` 를 비켜 간다 — 자체 인증이 있어서다.

| 잡 | 경로 | 주기 | 왜 그 주기인가 |
|---|---|---|---|
| C1 | `POST /api/cron/cleanup-unverified` | 일 1회 | 7일 경과 미검증 신청 삭제 — 급하지 않다 |
| C2 | `POST /api/cron/expire-requests` | 5분 | `REQUESTED` 가 슬롯을 묶고 있다. 늦으면 팔 수 있는 자리가 잠긴다 |
| C3 | `POST /api/cron/auto-no-show` | 일 1회 04:00 | 종료 후 `autoNoShowAfterHours`(기본 24h)를 넘긴 `CONFIRMED` 정리 |
| C8 | `POST /api/cron/expire-swaps` | 매시 | 근무 교대 요청 72시간 무응답 만료 — 72시간짜리 시한에 분 단위는 의미가 없다 |

넷 다 조건부 UPDATE 라 재실행이 무해하고, 한 번에 최대 500건씩 처리한다. C2 가 멈추면 콘솔 요약의 "승인 대기" 가 계속 늘어난다 — 그게 신호다.

**번호는 아직 명세와 맞지 않는다.** 여기 `C1` 은 명세·#99 의 `C1`(리마인더)이 아니고, `C8` 은 명세 표(C1~C7)에 없는 번호다.
리마인더가 없어서 지금은 안 부딪히지만 에픽 #14 가 들어오면 `C1` 이 두 개가 된다 — `LATER.md` L-44.

```bash
gcloud scheduler jobs create http majubom-expire-requests \
  --location=asia-northeast3 --schedule="*/5 * * * *" --time-zone="Asia/Seoul" \
  --uri="$BASE/api/cron/expire-requests" --http-method=POST \
  --headers="X-Cron-Secret=$(cat ~/.majubom/cron_secret)" --attempt-deadline=60s
```

시크릿을 명령줄에 직접 적으면 셸 히스토리에 남는다 — 파일에서 읽는다. 잡 설정에는 값이 저장되므로, 프로젝트 열람 권한을 가진 사람은 볼 수 있다.

### 의존성 취약점

`npm audit` 이 moderate 9건을 낸다. **전부 `firebase-tools`·`drizzle-kit` 안쪽의 전이 의존성이고, 앱이 쓰는 코드 경로가 아니다.**
`npm audit fix --force` 는 firebase-tools 를 10.1.1 로, drizzle-kit 을 0.18.1 로 **다운그레이드**하려 한다 — 쓰면 안 된다.

고친 둘은 `overrides` 에 있다:

| 패키지 | 왜 고쳤나 |
|---|---|
| `qs` → `^6.16.0` | qs 자체로는 minor 두 칸(6.14→6.16)이다. express 4 의 `~6.14.0`(`<6.15.0`) **밖**으로 강제하는 것이라 override 가 필요했다 — 경로가 firebase-tools → express 뿐이라 앱에 닿지 않는다 |
| `gaxios > uuid` → `^11.1.1` | **하나뿐인 프로덕션 경로**(`firebase-admin` → optional `@google-cloud/storage` → `gaxios`)라 닫아 뒀다 |

남긴 넷은 major 를 건너뛰어야 해서 두었다. 넷 다 **dev 전용**이고, `21-4 의존성 정비`(#147)에서 다시 본다:

- `esbuild <=0.24.2` — `@esbuild-kit/core-utils`(deprecated, drizzle-kit 이 아직 쓴다)가 `~0.18.20` 에 묶여 있다.
  취약점은 esbuild **dev 서버**의 CORS 인데 그 패키지는 transform API 만 쓴다 — 서버를 띄우지 않는다.
  `overrides` 로 0.25 를 밀어 봤지만 npm 이 그 중첩 경로에 적용하지 않는다.
- `csv-parse <7.0.2`(5→7) · `stream-json <=3.4.0`(1→3) · `@opentelemetry/core <2.8.0`(1→2) — 전부 firebase-tools 내부다.
  강제로 올리면 `npm run test:rules:emu` 가 쓰는 에뮬레이터가 깨질 수 있고, 그건 CI 게이트다.

`uuid` 건은 고치기 전에도 실제 위험은 없었다 — 권고문이 말하는 것은 v3/v5/v6 에 `buf` 를 넘길 때이고,
`gaxios` 는 multipart 경계에 `v4()` 만 쓴다. 게다가 우리는 `firebase-admin/app` 과 `/auth` 만 import 해서
`@google-cloud/storage` 가 아예 적재되지 않는다. 그래도 프로덕션 트리에 있는 유일한 건이라 닫는 쪽을 골랐다.

### 인증

Auth.js v5 + 서버 저장 리프레시 토큰. **액세스 스냅샷(JWT 쿠키) 15분 / 리프레시(회전) 30일**, 갱신과 콘솔 매 요청 상태 재확인은
`src/proxy.ts` 가 한다. 설계 근거와 결정 목록은 [src/features/auth/README.md](src/features/auth/README.md).

- 로컬 실행에는 `AUTH_SECRET`(32자+) 과 `AUTH_URL`(dev 포트) 이 필요하다. 소셜 로그인은 `AUTH_GOOGLE_*` / `AUTH_KAKAO_*` 가 있을 때만 켜진다.
- 메일(OTP·초대·재설정)은 `RESEND_API_KEY` 가 없으면 **서버 콘솔에 본문이 찍힌다** — 로컬에서는 거기서 코드·링크를 꺼내 쓴다.
- 화면: `/login` `/signup` `/signup/complete` `/signup/business` (+`/verify`) `/forgot-password` `/reset-password/[t]` `/invite/[t]`
  `/login/totp` · `/console` `/console/members` `/me/sessions` `/admin` (콘솔·관리자 화면은 자리표시자).

### 1기 게이트

고객이 없는 W1–W15 동안 프로덕션 URL은 `GATE_ENABLED=true`(기본)로 색인 차단(`X-Robots-Tag`, `robots.txt Disallow`)되고,
`GATE_BASIC_AUTH=user:pass`가 있으면 Basic Auth가 걸린다. `/api/auth/*`·`/api/health`는 예외. W16에 `GATE_ENABLED=false`.
게이트 뒤에 세션 처리(갱신·접근 제어)가 이어지며, 세션 처리에서 예외가 나도 게이트와 공개 페이지는 계속 동작한다.

## 브랜치 · 커밋 · 이슈

정본은 `majubom-docs/08_코드관리_전략.md`다. 요약하면:

- **메인 이슈(`epic`) 1개 = 브랜치 `feat/<N>-<slug>` 1개 = PR 1개.** 세부 이슈는 브랜치 없이 커밋 본문에 `#번호`를 멘션한다.
- PR 본문에 `Closes #<메인>`과 세부 이슈 `Closes #…`를 나열하면 머지 시 전부 닫힌다. **Squash merge만.**
- W15부터 `release`가 프로덕션이고 `main`은 스테이징이 된다.
- PR 제목은 `<type>(<scope>): <제목>` — type은 `feat` `fix` `db` `refactor` `chore`, scope는 선택. 로컬 커밋 제목은 자유.
- `db/*` PR은 `08` 5.6의 체크 항목을 채운다. 마이그레이션에 `CASCADE`를 쓰지 않는다 — `db:check`가 잡는다.

## 중단하고 돌아올 때

[NEXT.md](NEXT.md)의 3줄을 먼저 읽는다. 세션 끝에는 코드가 안 돌아도 `wip:` 커밋 후 push한다.
아직 못 정한 것은 [LATER.md](LATER.md)(추후 논의)에 모아 둔다 — 그 자리에서 임의로 정하지 않는다.

## 라이선스

별도 LICENSE 파일이 없으므로 **all rights reserved** 다. 코드는 열람할 수 있지만 사용·수정·배포 권한은 없다. (Q12 — [LATER.md](LATER.md) L-30)
