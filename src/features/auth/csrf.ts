import { HttpError } from "./errors";

/**
 * CSRF (FR-AUTH-030 "쿠키 인증이므로 SameSite=Lax + 상태 변경 요청에 CSRF 토큰").
 *
 * 토큰 대신 **Fetch Metadata + Origin 검사**를 쓴다. 근거: 세션 쿠키가 SameSite=Lax 라 교차 사이트 POST 에는 쿠키가
 * 붙지 않고, 그래도 오는 요청(구형 브라우저·Lax 예외)은 `Sec-Fetch-Site`/`Origin` 으로 잡는다. 이중 제출 토큰은
 * 서버 상태나 폼 배선이 필요해 1인 개발에서 빠뜨리기 쉽다 — 헤더 검사는 모든 상태 변경 라우트가 한 줄로 부른다.
 * Auth.js 자체 엔드포인트(/api/auth/*)는 자기 CSRF 토큰을 쓴다.
 *
 * 허용: Sec-Fetch-Site ∈ {same-origin, none(주소창 직접)} · 헤더가 없으면 Origin 이 요청 호스트와 같을 때.
 * 그 외(cross-site, same-site 서브도메인 포함) → 403 CSRF.
 */
export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin" || site === "none") return;
    throw new HttpError(403, "CSRF", { site });
  }
  const origin = req.headers.get("origin");
  // 비교 기준은 우리가 아는 호스트(AUTH_URL)다 — x-forwarded-host 는 프록시가 정규화하지 않으면 공격자 값끼리의 비교가 된다
  const host = expectedHost() ?? req.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "CSRF", { reason: "NO_ORIGIN" });
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "CSRF", { reason: "BAD_ORIGIN" });
  }
  if (originHost !== host) throw new HttpError(403, "CSRF", { reason: "ORIGIN_MISMATCH" });
}

function expectedHost(): string | null {
  const u = process.env.AUTH_URL;
  if (!u) return null;
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
