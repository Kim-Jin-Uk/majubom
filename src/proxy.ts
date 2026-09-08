import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_PREFIXES, PROTECTED_API_PREFIXES, PROTECTED_PAGE_PREFIXES } from "@/features/auth/constants";
import { refreshSession, type RefreshOutcome } from "@/features/auth/refresh";

/**
 * 프록시 = (1) 1기 게이트 (08 §3.1) + (2) 세션 갱신·접근 제어 (FR-AUTH-030).
 * Next 16 에서 middleware.ts 는 proxy.ts 로 이름이 바뀌었고 기본 런타임은 Node.js 다.
 *
 * (1) 게이트
 *   (a) GATE_ENABLED(기본 true) 이면 매치되는 모든 응답에 `X-Robots-Tag: noindex, nofollow`
 *   (b) 거기에 GATE_BASIC_AUTH="user:pass" 가 있으면 Basic Auth — 로그인 콜백(/api/auth/*),
 *       헬스체크(/api/health), robots.txt, favicon, Next 정적 자산은 예외
 *   게이트는 src/lib/env.ts 를 거치지 않는다 — DATABASE_URL 이 없다는 이유로 게이트가 죽어서는 안 된다.
 *
 * (2) 세션 (features/auth/refresh.ts)
 *   - 액세스 스냅샷(15분)이 지났으면 리프레시 토큰을 회전해 JWT 를 다시 쓴다. 실패하면 쿠키를 지운다.
 *   - /console·/admin(+API) 은 매 요청 상태를 재확인한다. 차단 사유가 있으면 페이지는 /login 으로, API 는 401/403.
 *   - /admin 은 ADMIN + TOTP 통과(mfa=ok) 여야 한다. ADMIN 이 아니면 404 (존재를 노출하지 않는다).
 *   세션 처리에서 예외가 나도 게이트와 공개 페이지는 계속 동작한다 — 실패는 "로그아웃 상태" 로 취급한다.
 */

const ROBOTS_HEADER = "noindex, nofollow";
const REALM = "majubom-preview";

/**
 * Basic Auth 를 요구하지 않는 경로. Auth.js 엔드포인트(소셜 콜백이 게이트를 통과해야 한다)·헬스체크·크론(자체 Bearer 인증)·정적 자산만.
 * 우리 자체 인증 라우트(/api/auth/signup, business-signup, password-reset …)는 **게이트 안**이다 — 1기 동안 가입·메일 발송이
 * 인터넷에 열리면 CAPTCHA 없이 둔 근거가 사라진다(리뷰 지적). 접두는 경계("/")를 지켜 /api/healthz 같은 우회를 막는다.
 */
const AUTH_EXEMPT_EXACT = ["/api/health", "/favicon.ico", "/robots.txt", "/api/auth/csrf", "/api/auth/session", "/api/auth/providers"];
const AUTH_EXEMPT_PREFIXES = ["/api/auth/callback", "/api/auth/signin", "/api/auth/signout", "/api/auth/error", "/api/cron", "/_next"];

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on", "enabled"].includes(v)) return true;
  if (["false", "0", "no", "n", "off", "disabled"].includes(v)) return false;
  return fallback;
}

function isAuthExempt(pathname: string): boolean {
  return AUTH_EXEMPT_EXACT.includes(pathname) || AUTH_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * 상수 시간 비교. 두 값을 SHA-256 으로 같은 길이로 만든 뒤 전체 바이트를 끝까지 XOR 한다 —
 * 길이 차이도, 앞부분 일치 여부도 타이밍으로 새지 않는다. Web Crypto 만 쓰므로
 * Node/Edge 어느 런타임에서도 동작한다.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(ha);
  const ub = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

/** "Basic xxxx" 헤더에서 "user:pass" 원문을 꺼낸다. 형식이 틀리면 null */
function decodeBasicCredentials(header: string | null): string | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return null;
  try {
    return atob(m[1]);
  } catch {
    return null;
  }
}

function unauthorized(gate: boolean): NextResponse {
  const res = new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
  if (gate) res.headers.set("X-Robots-Tag", ROBOTS_HEADER);
  return res;
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

/** Cookie 요청 헤더에서 name 의 값을 바꾼다 (없으면 덧붙이고, value 가 비면 뺀다) */
function replaceCookie(header: string | null, name: string, value: string): string {
  const parts = (header ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(name + "="));
  if (value) parts.push(`${name}=${value}`);
  return parts.join("; ");
}

function applyCookies(res: NextResponse, outcome: RefreshOutcome): NextResponse {
  for (const c of outcome.cookies) res.cookies.set(c.name, c.value, c.options);
  return res;
}

function loginRedirect(request: NextRequest, reason: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

function json(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** 세션·접근 제어. 응답을 돌려주면 그걸로 끝, null 이면 통과 (쿠키 변경은 pass-through 응답에 실린다). */
async function handleSession(request: NextRequest): Promise<{ block: NextResponse | null; outcome: RefreshOutcome }> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const protectedPage = startsWithAny(pathname, PROTECTED_PAGE_PREFIXES);
  const protectedApi = startsWithAny(pathname, PROTECTED_API_PREFIXES);
  const admin = startsWithAny(pathname, ADMIN_PREFIXES);

  // /api/auth/* 는 세션 처리를 건너뛴다 — Auth.js 와 우리 라우트(unstable_update)가 스스로 쿠키를 쓰므로, 프록시까지 같은 이름의
  // Set-Cookie 를 실으면 순서에 따라 한쪽이 유실된다(예: TOTP 통과 직후 mfa=ok 가 사라지는 경합). 이 경로들은 보호 대상도 아니다.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return { block: null, outcome: { state: "anon", cookies: [] } };

  let outcome: RefreshOutcome;
  try {
    outcome = await refreshSession(request);
  } catch (e) {
    console.error("[proxy] session refresh failed:", (e as Error).message);
    outcome = { state: "anon", cookies: [] };
  }

  if (!protectedPage && !protectedApi) return { block: null, outcome };

  if (outcome.state !== "auth") {
    const reason = outcome.state === "logout" ? outcome.reason : outcome.state === "pending" ? "PENDING_PROFILE" : "";
    if (outcome.state === "pending" && !isApi) {
      const url = request.nextUrl.clone();
      url.pathname = "/signup/complete";
      url.search = "";
      return { block: applyCookies(NextResponse.redirect(url), outcome), outcome };
    }
    return { block: applyCookies(isApi ? json(401, "UNAUTHENTICATED", { reason }) : loginRedirect(request, reason), outcome), outcome };
  }

  if (admin) {
    // 존재를 노출하지 않는다: 없는 경로로 rewrite 하면 Next 가 not-found 를 **404 상태**로 렌더한다 (rewrite 자체는 상태를 바꾸지 않는다)
    if (outcome.principal.globalRole !== "ADMIN") return { block: applyCookies(isApi ? json(404, "NOT_FOUND") : NextResponse.rewrite(new URL("/__not_found__", request.url)), outcome), outcome };
    if (outcome.token.mfa !== "ok") {
      if (isApi) return { block: applyCookies(json(403, "MFA_REQUIRED"), outcome), outcome };
      const url = request.nextUrl.clone();
      url.pathname = "/login/totp";
      url.search = "";
      url.searchParams.set("next", pathname);
      return { block: applyCookies(NextResponse.redirect(url), outcome), outcome };
    }
    return { block: null, outcome };
  }

  if (outcome.console?.denial) {
    const d = outcome.console.denial;
    if (d === "EMAIL_UNVERIFIED") {
      if (isApi) return { block: applyCookies(json(403, "EMAIL_UNVERIFIED"), outcome), outcome };
      const url = request.nextUrl.clone();
      url.pathname = "/signup/business/verify";
      url.search = "";
      return { block: applyCookies(NextResponse.redirect(url), outcome), outcome };
    }
    if (d === "NO_MEMBERSHIP") {
      // 소속 사업장이 없는 고객이 콘솔 URL 을 친 경우 — 사업자 가입으로 안내
      if (isApi) return { block: applyCookies(json(403, "NO_MEMBERSHIP"), outcome), outcome };
      const url = request.nextUrl.clone();
      url.pathname = "/signup/business";
      url.search = "";
      return { block: applyCookies(NextResponse.redirect(url), outcome), outcome };
    }
    return { block: applyCookies(isApi ? json(403, d) : loginRedirect(request, d), outcome), outcome };
  }
  return { block: null, outcome };
}

export async function proxy(request: NextRequest) {
  const gate = parseBool(process.env.GATE_ENABLED, true);
  const basicAuth = process.env.GATE_BASIC_AUTH?.trim() || undefined;
  const { pathname } = request.nextUrl;

  if (gate && basicAuth && !isAuthExempt(pathname)) {
    const supplied = decodeBasicCredentials(request.headers.get("authorization"));
    // 헤더가 없어도 비교는 한 번 수행해 응답 시간을 맞춘다
    const ok = await safeEqual(supplied ?? "", basicAuth);
    if (supplied === null || !ok) return unauthorized(gate);
  }

  const { block, outcome } = await handleSession(request);
  if (block) {
    if (gate) block.headers.set("X-Robots-Tag", ROBOTS_HEADER);
    return block;
  }

  // 콘솔 읽기 전용(SUSPENDED)은 헤더로 라우트에 알린다 — 쓰기 API 가 각자 거부한다
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-majubom-readonly"); // 클라이언트가 보낸 값은 버린다 — 프록시만 정한다
  if (outcome.state === "auth" && outcome.console?.readOnly) requestHeaders.set("x-majubom-readonly", "1");
  // 이 요청에서 JWT 를 새로 썼으면 다운스트림(auth())도 새 값을 보게 요청 쿠키를 바꿔 넘긴다 —
  // 그렇지 않으면 이 한 요청은 옛 스냅샷으로 처리된다.
  for (const c of outcome.cookies) {
    // 값이 비면 삭제 — 다운스트림에도 없는 것으로 보여야 한다. 안 그러면 Auth.js 세션 엔드포인트가 옛 JWT 를 읽어
    // 로그아웃시킨 쿠키를 도로 심는다.
    requestHeaders.set("cookie", replaceCookie(requestHeaders.get("cookie"), c.name, c.value));
  }
  const res = applyCookies(NextResponse.next({ request: { headers: requestHeaders } }), outcome);
  if (gate) res.headers.set("X-Robots-Tag", ROBOTS_HEADER);
  return res;
}

export const config = {
  // 정적 자산·이미지 최적화·favicon 은 제외 — 색인 대상도 아니고 요청마다 게이트·세션 처리를 태울 이유가 없다.
  // 나머지(페이지, API, robots.txt)는 전부 거친다; Basic Auth 예외는 코드에서 건다.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
