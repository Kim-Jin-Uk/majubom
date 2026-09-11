@AGENTS.md

# 마주,봄 — 작업 규칙 (요약)

정본 문서는 private 저장소 `majubom-docs`에 있다. 어긋나면 `02_기능명세서.md`가 정본.

- **작업 단위**: 메인 이슈(`epic`) 1개 = 브랜치 `feat/<N>-<slug>` 1개 = PR 1개. 세부 이슈는 브랜치 없이 커밋 본문에 `#번호` 멘션. 닫는 건 PR 본문의 `Closes #…`.
- **커밋**: 로컬 커밋 제목은 자유, 본문 마지막 줄에 세부 이슈 번호. PR 제목만 `<type>(<scope>): <제목>` (feat·fix·db·refactor·chore).
- **마이그레이션**: `drizzle/` 에 `CASCADE` 금지. 제약 술어 컬럼은 `NOT NULL DEFAULT`. enum 값 추가는 별도 파일. `npm run db:check` 가 불변 제약을 검사한다.
- **검증**: push 전 `npm run verify` (typecheck + lint + test). CI는 게이트, 진단 도구가 아니다.
- **비밀**: `.env.local` 만. 서비스 계정 JSON·`.pem` 은 커밋 금지 (`.gitignore` 가 막지만 확인).
- **커밋 신원**: author 는 GitHub `noreply` 주소로 둔다. 회사 이메일이 커밋에 들어가면 안 된다 —
  스쿼시 머지는 브랜치 커밋의 author 를 `Co-authored-by:` 로 옮겨 심으므로, 로컬 `user.email` 부터 맞춰 둘 것.
  에이전트 커밋의 트레일러는 `Co-Authored-By: Claude <noreply@anthropic.com>` **한 줄만** — 세션 링크는 넣지 않는다.
- **PR 본문**: `Closes #…` 는 **한 줄에 하나**. 스택 PR 을 머지 없이 닫으면 그 `Closes` 가 동작하지 않으므로,
  내용을 이어받는 PR 이 이슈를 다시 닫아 줘야 한다.
- **이슈·PR 은 에이전트가 직접 만든다.** 생성 스크립트를 사람에게 건네지 않는다.
- **포매터**: 저장소에 prettier 설정이 없다. 돌리지 말 것 — 손대지 않은 파일까지 통째로 바뀐다.
- **세션 종료**: `NEXT.md` 3줄 갱신 → 코드가 안 돌아도 `wip:` 커밋 → push.
- **미정 사항**: 결정이 필요한데 아직 못 정한 것은 그 자리에서 임의로 정하지 말고 `LATER.md` 에 `L-nn` 으로 적는다. 정해지면 그 줄을 지우고 정본·README 로 옮긴다. (정했는데 안 만든 것은 각 `features/*/README.md` 의 "아직 안 한 것".)
