/**
 * 로컬·CI 에서만 켤 수 있는 우회 스위치. **프로덕션에서는 어떤 값을 넣어도 꺼진다.**
 *
 * 여기 한 곳에서만 판단하는 이유: 호출부마다 `process.env.NODE_ENV` 를 다시 보면 언젠가 한 군데가 빠지고,
 * 그 한 군데가 프로덕션의 2단계 인증을 여는 구멍이 된다.
 */

/** 프로덕션이면 무조건 false. 빌드 타임이 아니라 호출 시점에 본다 — 테스트가 `vi.stubEnv` 로 바꿀 수 있어야 한다 */
const notProduction = (): boolean => process.env.NODE_ENV !== "production";

/**
 * ADMIN 2단계 인증(TOTP)을 건너뛴다 — `AUTH_DEV_SKIP_TOTP=true` 이고 **프로덕션이 아닐 때만**.
 *
 * 왜 필요한가: `/admin` 은 첫 진입에서 TOTP 등록을 강제한다(FR-AUTH-030). 로컬 확인과 E2E 에서는
 * 인증 앱을 붙일 수 없어 관리자 화면을 아예 열 수 없다. 그렇다고 프로덕션 코드에서 검사를 빼면
 * 운영자 계정이 비밀번호 하나로 열린다 — 그래서 **환경으로만** 연다.
 *
 * `serverEnv` 스키마가 production + 이 플래그 조합을 거부하므로, 실수로 배포 설정에 넣으면 부팅이 실패한다.
 */
export const skipTotp = (): boolean => notProduction() && process.env.AUTH_DEV_SKIP_TOTP === "true";
