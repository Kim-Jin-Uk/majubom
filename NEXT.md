# 다음에 할 일

> 세션을 끝낼 때 이 세 줄만 갱신하고 커밋에 포함한다.
> 2주 쉬었다 돌아왔을 때 이 파일이 유일한 복귀 지점이다. (`majubom-docs/08` 11.1)

## 지금 어디

메인 이슈 #1 기반 구축 — 코드 쪽 9건 완료 (#2 #3 #4 #5 #6 #8 #10 #11 #13).
브랜치 `feat/1-foundation`. `npm run verify` · `db:check` 9/9 · `build` 통과.

## 막힌 것

콘솔 잔여 3건 (각 1분): ① R2 CORS — Cloudflare 콘솔 → majubom-media → Settings → CORS policy 에 `infra/r2-cors.json` 붙여넣기 (#9) ② GitHub → Settings → Environments → staging → secret `DATABASE_URL_MIGRATE` = Neon 직결 URL (#14) ③ R2 토큰 Roll — 키가 채팅에 노출됐다.
#12 도메인·카카오는 보류 — W12 전 착수.
Firestore 규칙 테스트는 로컬 에뮬레이터 JAR 다운로드가 막혀 CI 첫 실행에서 확인해야 한다.
슬롯 픽스처 가정 A1·A7은 명세 모순 — 이슈 #13 코멘트 참조. 구현(#48) 전에 결정.
**Node 22 로 올릴 것** — 지금 v20.20 (EOL 지남). `nvm install 22 && nvm use` (.nvmrc 있음).

## 다음 한 수

1. `nvm use` (Node 22) → `.env.local` 의 DATABASE_URL 을 로컬 Postgres 로 → `npm run db:reset && npm run verify`
   (R2 는 `npm run r2:verify` 5/5 통과 확인함)
2. PR 열기: `feat(infra): 기반 구축` — 본문에 `Closes #1` + `Closes #2, #3, #4, #5, #6, #8, #10, #11, #13`
3. 콘솔 작업 #7 #9 #12 #14 (README·`majubom-docs/07` 7장 순서대로)
