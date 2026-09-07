import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 1기 게이트 (08 §3.1). Next 16 에서 middleware.ts 는 proxy.ts 로 이름이 바뀌었고
 * 기본 런타임은 Node.js 다 (`runtime` 세그먼트 옵션은 여기서 쓸 수 없다).
 *
 * (a) GATE_ENABLED(기본 true) 이면 매치되는 모든 응답에 `X-Robots-Tag: noindex, nofollow`
 * (b) 거기에 GATE_BASIC_AUTH="user:pass" 가 있으면 Basic Auth — 카카오 로그인 콜백(/api/auth/*),
 *     헬스체크(/api/health), robots.txt, favicon, Next 정적 자산은 예외
 *
 * 이 파일은 src/lib/env.ts 를 import 하지 않는다 — proxy 는 앱 본체와 분리된 경계에서 돌고,
 * DATABASE_URL 이 없다는 이유로 게이트 자체가 죽어서는 안 된다. process.env 를 직접, 최소한만 읽는다.
 */

const ROBOTS_HEADER = "noindex, nofollow";
const REALM = "majubom-preview";

/** Basic Auth 를 요구하지 않는 경로 접두 */
const AUTH_EXEMPT_PREFIXES = ["/api/auth/", "/api/health", "/_next/", "/favicon.ico", "/robots.txt"];

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on", "enabled"].includes(v)) return true;
  if (["false", "0", "no", "n", "off", "disabled"].includes(v)) return false;
  return fallback;
}

function isAuthExempt(pathname: string): boolean {
  return AUTH_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
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

  const res = NextResponse.next();
  if (gate) res.headers.set("X-Robots-Tag", ROBOTS_HEADER);
  return res;
}

export const config = {
  // 정적 자산·이미지 최적화는 제외 — 색인 대상도 아니고 요청마다 게이트를 태울 이유가 없다.
  // 나머지(페이지, API, robots.txt, favicon)는 전부 거친다; Basic Auth 예외는 코드에서 건다.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
