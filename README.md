# 마주,봄

소규모 사업장을 위한 예약 SaaS. 업종에 상관없이 **"자원의 시간 구간을 정원 안에서 점유한다"** 는
하나의 스키마로 담당자형·공간형·수업형 예약을 모두 처리한다.

## 문서

기획서·기능명세서·ERD·스택 산정·코드 관리 전략은 **별도 private 저장소 [`majubom-docs`](https://github.com/Kim-Jin-Uk/majubom-docs)** 에 있다.
사업 계획·지표·비용이 들어 있어 코드와 분리했다. 문서가 서로 어긋나면 `02_기능명세서.md`가 정본이다.

## 스택

- **Next.js 15 (App Router)** · TypeScript · Drizzle
- **PostgreSQL (Neon)** — 예약 엔진. `EXCLUDE USING gist`로 이중 예약을 DB가 물리적으로 거부
- **Firestore** — 채팅만. 보안 규칙으로 인가
- **Firebase App Hosting** — 배포 (Blaze 종량제 필수)
- **FCM** · Resend · Cloudflare R2 · Sentry

## 로컬 실행

```bash
cp .env.example .env.local     # 값 채우기
npm ci
npm run db:migrate
npm run dev
```

## 브랜치 · 커밋

정본은 `majubom-docs/08_코드관리_전략.md`다. 요약하면:

- 작업은 `feat/*` · `fix/*` · `db/*`에서 하고 PR로 `main`에 합친다. **Squash merge만.**
- W15부터 `release`가 프로덕션이고 `main`은 스테이징이 된다.
- PR 제목은 `<type>(<scope>): <제목>` — type은 `feat` `fix` `db` `refactor` `chore` 5종, scope는 선택.
- **로컬 커밋 메시지는 자유다.** squash로 사라진다.
- `db/*` PR은 `08` 5.6의 체크 항목을 채운다.

## 중단하고 돌아올 때

[NEXT.md](NEXT.md)의 3줄을 먼저 읽는다. 세션 끝에는 코드가 안 돌아도 `wip:` 커밋 후 push한다.

## 라이선스

별도 LICENSE 파일이 없으므로 **all rights reserved** 다. 코드는 열람할 수 있지만 사용·수정·배포 권한은 없다. (Q12 — 추후 재검토)
