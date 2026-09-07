@AGENTS.md

# 마주,봄 — 작업 규칙 (요약)

정본 문서는 private 저장소 `majubom-docs`에 있다. 어긋나면 `02_기능명세서.md`가 정본.

- **작업 단위**: 메인 이슈(`epic`) 1개 = 브랜치 `feat/<N>-<slug>` 1개 = PR 1개. 세부 이슈는 브랜치 없이 커밋 본문에 `#번호` 멘션. 닫는 건 PR 본문의 `Closes #…`.
- **커밋**: 로컬 커밋 제목은 자유, 본문 마지막 줄에 세부 이슈 번호. PR 제목만 `<type>(<scope>): <제목>` (feat·fix·db·refactor·chore).
- **마이그레이션**: `drizzle/` 에 `CASCADE` 금지. 제약 술어 컬럼은 `NOT NULL DEFAULT`. enum 값 추가는 별도 파일. `npm run db:check` 가 불변 제약을 검사한다.
- **검증**: push 전 `npm run verify` (typecheck + lint + test). CI는 게이트, 진단 도구가 아니다.
- **비밀**: `.env.local` 만. 서비스 계정 JSON·`.pem` 은 커밋 금지 (`.gitignore` 가 막지만 확인).
- **세션 종료**: `NEXT.md` 3줄 갱신 → 코드가 안 돌아도 `wip:` 커밋 → push.
