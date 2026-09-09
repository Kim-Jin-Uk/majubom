# 인증 · 계정 (에픽 #15) — 설계 기록

정본은 `02_기능명세서.md` §3.1 (FR-AUTH-010 ~ 040). 이 문서는 명세가 정하지 않은 것을 이 코드베이스에서 어떻게 결정했는지만 적는다.

## 한 장 요약

```
브라우저 ──쿠키 2개──▶ proxy.ts ──▶ refresh.ts ──▶ (필요할 때만) DB
  majubom.session  = Auth.js JWT(JWE) = 액세스 스냅샷 { uid, sid, p(principal), accessExp(15분), mfa }
  majubom.refresh  = "<sid>.<secret>"  → sessions.token_hash = sha256(secret), 30일 절대 만료, 회전
```

| 언제 | 누가 | 무엇 |
|---|---|---|
| 로그인 | Auth.js `jwt` 콜백 (Route Handler 컨텍스트) | sessions 행 생성, 리프레시 쿠키, JWT 채움 |
| 매 요청 | `proxy.ts` → `refresh.ts` | accessExp 지났으면 회전 + principal 재조회 + JWT 재발급. 콘솔·관리자 경로는 항상 상태·세션 재확인 |
| RSC · 라우트 | `auth()` / `guards.ts` | JWT 스냅샷만 읽는다. DB 안 친다 (스코프 판정만) |
| 로그아웃 | Auth.js `events.signOut` | sessions 행 폐기. 남은 쿠키는 프록시가 다음 요청에서 정리 |

## 왜 이렇게 했나

**회전을 Auth.js `jwt` 콜백이 아니라 프록시에서 하는 이유.** next-auth v5 는 서버 컴포넌트에서 `auth()` 를 부르면 세션 응답의
`Set-Cookie` 를 버린다(RSC 는 쿠키를 못 쓴다). `jwt` 콜백에서 DB 토큰을 회전하면 DB 는 바뀌고 클라이언트 쿠키는 그대로 —
다음 요청부터 전부 어긋난다. 프록시는 모든 요청 앞에서 응답 쿠키를 쓸 수 있는 유일한 지점이다. 재발급한 JWT 는 요청 헤더에도
바꿔 넣어(`replaceCookie`) 같은 요청의 `auth()` 가 새 스냅샷을 본다.

**두 쿠키인 이유.** JWT 하나에 리프레시 시크릿을 넣으면 Auth.js 가 세션 조회마다 JWT 를 다시 써서(슬라이딩) "회전" 의
의미가 없어진다. 리프레시는 Auth.js 밖(`session-store.ts`)에 두고 절대 만료(30일)를 지킨다.

**유예 창(60초).** 같은 브라우저의 동시 요청 두 개가 같은 옛 토큰으로 회전을 시도하면 UPDATE 는 하나만 성공한다. 나머지는
`prev_token_hash` 와 `rotated_at` 으로 유예 안이면 통과(쿠키는 건드리지 않음 — `rotated: false`). 유예 밖의 옛 토큰 재사용은
탈취로 보고 세션을 폐기한다.

**"매 요청 재확인" 의 범위.** `/console` `/admin` `/me`(+`/api/…`) 는 accessExp 와 무관하게 매 요청
`users.status · business_members.status · businesses.status(+emailVerifiedAt) · sessions.revoked_at` 을 본다 (인덱스 조회 2~3회).
스냅샷이 달라지면 JWT 를 그 자리에서 다시 쓴다 — 권한 변경·기기 폐기도 15분을 기다리지 않는다(기기 관리 화면이 15분 늦으면
그 화면이 무의미하다). 그 밖의 고객 경로는 15분 스냅샷을 믿는다. 콘솔 접근 판정(소속·사업장 상태)은 콘솔·관리자 경로에만 건다.

**CSRF 는 토큰이 아니라 헤더.** 쿠키가 `SameSite=Lax` 라 교차 사이트 POST 에는 쿠키가 안 붙고, 그래도 오는 요청은
`Sec-Fetch-Site`(same-origin/none 만 허용) 또는 `Origin`↔`Host` 로 잡는다(`csrf.ts`). 상태 변경 라우트는 첫 줄에
`assertSameOrigin(req)`. Auth.js 자체 엔드포인트는 자기 CSRF 토큰을 쓴다.

**`unstable_update()` 를 믿지 않는다.** Auth.js 세션 update 엔드포인트(`POST /api/auth/session`)는 CSRF 토큰만 있으면
클라이언트도 부를 수 있다. 그래서 `jwt` 콜백은 update 본문을 그대로 반영하지 않고
- `bindUid`: pending 소셜 프로필의 (provider, providerAccountId) 와 일치하는 사용자만 바인딩
- `mfaProof`: `HMAC(AUTH_SECRET 파생키, "mfa:" + sid + ":" + 분 슬롯)` 가 맞을 때만 `mfa=ok` — 발급 후 2분 안에만 유효 (`crypto.serverProof`)

**쿠키 삭제는 `maxAge:0` + `expires:epoch` 둘 다.** Next 가 Set-Cookie 를 다시 직렬화할 때(미들웨어·`cookies()` 병합)
falsy 값을 압축해 `Max-Age=0` 이 사라진다 — 삭제가 "세션 쿠키" 로 둔갑한다. Auth.js 가 지운 세션 쿠키가 빈 값으로 남는
경우도 프록시가 정리한다. 같은 이유로 `events.signOut` 안에서 `cookies().set` 을 부르지 않는다.

**비밀번호는 scrypt, 메모리 작은 조합.** Node 내장이라 네이티브 빌드가 없다(CI·App Hosting 빌드팩에서 깨질 여지 없음).
N=2^14·r=8·p=5·64B — OWASP 권고 조합 중 **16 MiB** 짜리. 처음엔 N=2^17(128 MiB)였는데 App Hosting 인스턴스가 512 MiB 라
로그인 몇 건이 동시에 오면 OOM 이었다(리뷰 지적). 여기에 프로세스 전역 세마포어(동시 4개)로 미인증 요청의 메모리 폭주를 막고,
저장된 파라미터가 비정상적으로 크면(조작된 행) 계산을 거부한다. 포맷에 파라미터가 있어 기존 해시는 검증되고 로그인 시 재해시된다.

**로그인 실패 백오프는 감사 로그가 카운터.** `LOGIN_FAIL`(target = 이메일 해시) 15분 창 5회부터 1s→32s — 계정 단위. 여기에
**IP 단위 상한**(15분 50회, IP 를 모르면 "알 수 없음" 버킷)을 겹친다: 계정을 바꿔 가며 찍는 스터핑과 scrypt 비용 폭주 방어.
백오프·IP 상한에 걸린 시도는 **로그를 남기지 않는다** — 남기면 공격이 자기 백오프를 연장하고 로그를 무한히 늘린다.
TOTP 오입력도 같은 장치(키 `totp:<uid>`), 10회면 세션 폐기(하드락).

**`x-forwarded-for` 는 오른쪽부터 믿는다.** 왼쪽 값은 클라이언트가 넣을 수 있다. 우리 앞 프록시가 *덧붙인* 오른쪽 값을 클라이언트
IP 로 보고(`TRUSTED_PROXY_HOPS`, 기본 0 = Cloud Run 직결), 파싱 실패는 null → 레이트리밋은 null 을 "알 수 없음" 버킷으로 **센다**
(건너뛰면 헤더 한 줄로 제한이 사라진다). 사업자 가입 IP 카운터는 `auth_tokens` 발급 행 — 신청을 지워도 행은 남긴다(`user_id` nullable).

**원자적 카운터.** OTP 시도 횟수는 `UPDATE … SET attempts = attempts+1 WHERE attempts < 5 RETURNING` 한 문장(읽고-검사하고-쓰면
동시 요청이 전부 통과한다). TOTP 는 마지막 통과 스텝을 저장해 같은 코드의 재사용을 막고, 소셜 자동 연결·초대 수락도 조건부 UPDATE 의
영향 행 수로 판정한다. **드리즐 트랜잭션 콜백에서 `return` 은 항상 COMMIT** — 실패는 던져서 롤백시킨다(`acceptInvite`). 트랜잭션 안의
`writeAudit` 은 삼키지 않고 다시 던진다(PG 는 실패 후 COMMIT 을 조용히 ROLLBACK 으로 바꾼다).

## 소셜 계정 규칙 (FR-AUTH-030 "소셜 계정 연결")

1. `(provider, provider_account_id)` 로 찾는다 — 있으면 그 사용자.
2. 없고 이메일이 왔으면: 같은 이메일 사용자가 있고 **제공자가 검증을 보증**(Google `email_verified`, Kakao `is_email_verified`)
   → 자동 연결(`provider` 를 소셜로 바꾸고 `provider_account_id` 기록, 비밀번호는 유지). 미검증 → `/login?error=email_taken`.
   같은 이메일 사용자가 없으면 신규 생성.
3. 이메일이 없으면(카카오 선택 동의) JWT 에 `pending` 만 넣고 `/signup/complete` 에서 이메일을 받는다. 검증 링크는 비동기.

한 사용자는 `provider` 하나만 갖는다(enum). "LOCAL 계정에 소셜 연결" 은 `provider` 가 소셜로 바뀌는 것이고 비밀번호 로그인은
그대로 된다. 여러 소셜을 한 계정에 붙이는 것은 2기.

## 사업자 가입 순서 (FR-AUTH-010 vs 04 플로우 1)

02 는 "OTP 검증 통과 후 생성", 04 는 "생성 후 검증, 미검증 7일 삭제" — **04 를 따른다**(그래야 `emailVerifiedAt IS NULL` 정리 배치가
의미를 갖고 이메일·사업자번호 선점을 막을 수 있다). 콘솔은 `consoleAccess` 가 `EMAIL_UNVERIFIED` 로 막고 프록시가
`/signup/business/verify` 로 보낸다. 반려된 신청의 재신청은 같은 소유자 이메일이면 사업장을 PENDING 으로 되돌려 재사용한다
(감사 로그가 사업장을 참조하므로 지우지 않는다).

## 게이트와의 관계

프록시의 Basic Auth 예외는 **Auth.js 엔드포인트(`/api/auth/callback|signin|signout|error/*`, `csrf|session|providers`)·헬스체크·크론**만이다.
우리 자체 라우트(`/api/auth/signup`, `business-signup`, `password-reset`…)는 게이트 **안** — 처음엔 `/api/auth/` 접두 전체를
열어 두어 가입·메일 발송이 인터넷에 노출돼 있었다(리뷰 지적). `/api/auth/*` 요청은 프록시의 세션 갱신도 건너뛴다 — Auth.js 와
`unstable_update` 가 스스로 쿠키를 쓰는데 프록시까지 같은 이름을 실으면 한쪽이 유실된다.

## 운영 절차 — ADMIN 부트스트랩

`npm run admin:promote -- <email>` 직후 **바로** `/admin` 에 들어가 TOTP 등록을 끝낸다. 등록 전까지는 비밀번호만으로 시크릿을 등록할
수 있는 창이 열려 있다(그 시점엔 2FA 가 없으니 당연하다). ADMIN 의 TOTP 는 `/admin`·`/api/admin` 에만 강제된다 — ADMIN 이 고객·콘솔
경로를 쓸 때는 일반 사용자와 같다.

## 아직 안 한 것 (의도적)

결정이 아직 안 된 것(다중 소속·소셜 계정 연결 UX·사업자번호 진위 확인 등)은 루트 `LATER.md` 로 옮겼다 — L-02·L-04·L-22.

- CAPTCHA(FR-AUTH-010 "발송 전 CAPTCHA") — 1기 게이트(Basic Auth) 뒤라 생략. 게이트를 내리는 #12 에서 Turnstile.
- `auth_tokens`(사용·만료) · `sessions`(폐기·만료) · `audit_logs`(1년) 정리 배치 — 알림/운영 에픽의 C 배치와 함께.
- `selectionId`(예약 위젯 30분 임시 선택 토큰) — 예약 에픽(#47)에서.
- 관리자 알림(BUSINESS_APPLIED) — 알림 에픽에서 Notification 으로. 지금은 접수 확인 메일 + 서버 로그.
- TOTP QR — 라이브러리 대신 시크릿 텍스트 + `otpauth://` 링크. 관리자 1인이라 충분.
- 카카오 프로바이더 실 연결 — 앱 등록(#12) 후 env 만 넣으면 켜진다. 코드는 `readIdentity` 가 `kakao_account` 를 이미 읽는다.

## 파일 지도

| 파일 | 역할 |
|---|---|
| `auth.ts` | NextAuth 설정 · 프로바이더 · `jwt`/`session` 콜백 · `LoginError` |
| `refresh.ts` | 프록시용 갱신·회전·콘솔 재확인 결정 (응답은 `proxy.ts` 가 만든다) |
| `session-store.ts` | sessions 테이블: 생성·회전(유예)·폐기·목록 |
| `principal.ts` | JWT 스냅샷 로딩 · `consoleAccess` 판정 |
| `guards.ts` | `requireUser/Console/Owner/Admin` · `assertWritable` · `handle()` |
| `csrf.ts` · `errors.ts` · `cookies.ts` · `constants.ts` · `crypto.ts` · `validation.ts` | 공통 |
| `oauth-account.ts` | 소셜 → 사용자 매핑 · pending 마무리 |
| `tokens.ts` | auth_tokens: 단일사용 토큰 · OTP |
| `business-signup.ts` · `members.ts` · `password-reset.ts` · `totp.ts` · `login-backoff.ts` | 기능별 서비스 |
| `ui/*` | 클라이언트 폼 (`hardNavigate` — 로그인 직후는 전체 이동) |
