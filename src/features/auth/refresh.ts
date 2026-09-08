import { decode, encode, type JWT } from "@auth/core/jwt";
import type { NextRequest } from "next/server";
import { requestMeta } from "@/lib/request-meta";
import { ACCESS_TTL_SEC, ADMIN_PREFIXES, CONSOLE_PREFIXES, COOKIE_REFRESH, COOKIE_SESSION, REFRESH_TTL_SEC } from "./constants";
import { clearedRefreshCookie, clearedSessionCookie, refreshCookie } from "./cookies";
import { consoleAccess, loadPrincipal, principalEquals, userLoginDenial, type AccessDenial, type Principal } from "./principal";
import { parseRefresh, rotateSession } from "./session-store";
import "./types";

/**
 * 프록시(src/proxy.ts)가 매 요청 호출하는 세션 갱신 (FR-AUTH-030 세션 정책).
 *
 * 1. 세션 쿠키(JWT)를 복호화한다. 없으면 anon.
 * 2. accessExp(15분)이 지났으면 리프레시 쿠키를 sessions 테이블과 대조해 **회전**하고 principal 을 다시 읽어 JWT 를 새로 쓴다.
 *    회전 실패(폐기·만료·재사용) → 두 쿠키를 지운다 = 로그아웃.
 * 3. 콘솔·관리자 경로는 accessExp 와 무관하게 **매 요청** User·BusinessMember·Business 상태를 재확인한다
 *    (명세: "콘솔 미들웨어는 매 요청 status 재확인"). 스냅샷이 바뀌었으면 JWT 를 다시 쓴다 — 권한 변경이 15분을 기다리지 않는다.
 *
 * 이 모듈은 결정만 내리고 응답은 만들지 않는다. 쿠키 변경 목록을 돌려주고 proxy.ts 가 응답에 싣는다.
 */
export type CookieOp = { name: string; value: string; options: Record<string, unknown> };

export type RefreshOutcome =
  | { state: "anon"; cookies: CookieOp[] }
  | { state: "pending"; cookies: CookieOp[] }
  | { state: "auth"; token: JWT; principal: Principal; cookies: CookieOp[]; console: { denial: AccessDenial | null; readOnly: boolean } | null }
  | { state: "logout"; reason: string; cookies: CookieOp[] };

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET 이 없다");
  return s;
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export function isConsolePath(path: string): boolean {
  return startsWithAny(path, CONSOLE_PREFIXES) || startsWithAny(path, ADMIN_PREFIXES);
}

function op(c: { name: string; value: string; options: object }): CookieOp {
  return { name: c.name, value: c.value, options: c.options as Record<string, unknown> };
}

function logout(reason: string, extra: CookieOp[] = []): RefreshOutcome {
  return { state: "logout", reason, cookies: [op(clearedSessionCookie()), op(clearedRefreshCookie()), ...extra] };
}

export async function refreshSession(req: NextRequest): Promise<RefreshOutcome> {
  const raw = req.cookies.get(COOKIE_SESSION)?.value;
  if (!raw) {
    // 로그아웃 직후의 잔재 정리: Auth.js 가 지운 세션 쿠키는 Next 의 재직렬화(Max-Age=0 탈락)로 빈 값 쿠키로 남을 수 있고,
    // 리프레시 쿠키는 세션 없이는 쓸모가 없다. 둘 다 있으면 지운다.
    const cookies: CookieOp[] = [];
    if (req.cookies.has(COOKIE_SESSION)) cookies.push(op(clearedSessionCookie()));
    if (req.cookies.has(COOKIE_REFRESH)) cookies.push(op(clearedRefreshCookie()));
    return { state: "anon", cookies };
  }

  let token: JWT | null = null;
  try {
    token = await decode({ token: raw, secret: secret(), salt: COOKIE_SESSION });
  } catch {
    token = null;
  }
  if (!token) return logout("BAD_JWT");
  if (token.pending && !token.uid) return { state: "pending", cookies: [] };
  if (!token.uid || !token.sid) return logout("NO_UID");

  const now = Math.floor(Date.now() / 1000);
  const needsRefresh = !token.accessExp || token.accessExp <= now;
  const path = req.nextUrl.pathname;
  const onConsole = isConsolePath(path);
  const cookies: CookieOp[] = [];
  let changed = false;

  if (needsRefresh) {
    const rt = parseRefresh(req.cookies.get(COOKIE_REFRESH)?.value);
    if (!rt || rt.sid !== token.sid) return logout("NO_REFRESH");
    const r = await rotateSession(rt, requestMeta(req.headers));
    if (!r.ok) return logout(`REFRESH_${r.reason}`);
    if (r.userId !== token.uid) return logout("UID_MISMATCH");
    if (r.rotated) cookies.push(op(refreshCookie(r.token)));
    token.accessExp = now + ACCESS_TTL_SEC;
    changed = true;
  }

  let principal = token.p ?? null;
  if (needsRefresh || onConsole || !principal) {
    const fresh = await loadPrincipal(token.uid);
    if (!fresh || userLoginDenial(fresh)) return logout("USER_INACTIVE");
    if (!principal || !principalEquals(principal, fresh)) {
      token.p = fresh;
      token.name = fresh.name;
      // ADMIN 권한이 사라졌거나 새로 생겼으면 mfa 상태를 다시 계산한다
      if (fresh.globalRole !== "ADMIN") token.mfa = "ok";
      else if (principal?.globalRole !== "ADMIN") token.mfa = "pending";
      changed = true;
      principal = fresh;
    }
  }

  if (changed) {
    const encoded = await encode({ token, secret: secret(), salt: COOKIE_SESSION, maxAge: REFRESH_TTL_SEC });
    cookies.push({
      name: COOKIE_SESSION,
      value: encoded,
      options: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: REFRESH_TTL_SEC },
    });
  }

  return { state: "auth", token, principal: principal!, cookies, console: onConsole ? consoleAccess(principal!) : null };
}
