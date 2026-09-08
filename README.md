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
| `npm test` | vitest 유닛 (슬롯 계산 40건은 `todo`, 구현은 이슈 #7) |
| `npm run test:rules:emu` | Firestore 보안 규칙 테스트 (에뮬레이터 기동 포함, Java 필요) |
| `npm run db:generate` | 스키마 변경 → 마이그레이션 SQL 생성 |
| `npm run db:migrate` | 마이그레이션 적용 (직결 연결 · `lock_timeout 3s` · 재시도) |
| `npm run db:check` | 불변 제약 검사 — CI `verify` 잡에서도 돈다 |

### 1기 게이트

고객이 없는 W1–W15 동안 프로덕션 URL은 `GATE_ENABLED=true`(기본)로 색인 차단(`X-Robots-Tag`, `robots.txt Disallow`)되고,
`GATE_BASIC_AUTH=user:pass`가 있으면 Basic Auth가 걸린다. `/api/auth/*`·`/api/health`는 예외. W16에 `GATE_ENABLED=false`.

## 브랜치 · 커밋 · 이슈

정본은 `majubom-docs/08_코드관리_전략.md`다. 요약하면:

- **메인 이슈(`epic`) 1개 = 브랜치 `feat/<N>-<slug>` 1개 = PR 1개.** 세부 이슈는 브랜치 없이 커밋 본문에 `#번호`를 멘션한다.
- PR 본문에 `Closes #<메인>`과 세부 이슈 `Closes #…`를 나열하면 머지 시 전부 닫힌다. **Squash merge만.**
- W15부터 `release`가 프로덕션이고 `main`은 스테이징이 된다.
- PR 제목은 `<type>(<scope>): <제목>` — type은 `feat` `fix` `db` `refactor` `chore`, scope는 선택. 로컬 커밋 제목은 자유.
- `db/*` PR은 `08` 5.6의 체크 항목을 채운다. 마이그레이션에 `CASCADE`를 쓰지 않는다 — `db:check`가 잡는다.

## 중단하고 돌아올 때

[NEXT.md](NEXT.md)의 3줄을 먼저 읽는다. 세션 끝에는 코드가 안 돌아도 `wip:` 커밋 후 push한다.

## 라이선스

별도 LICENSE 파일이 없으므로 **all rights reserved** 다. 코드는 열람할 수 있지만 사용·수정·배포 권한은 없다. (Q12 — 추후 재검토)
