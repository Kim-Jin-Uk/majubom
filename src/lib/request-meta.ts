/**
 * 요청 메타 (IP · User-Agent). 감사 로그·세션 기기 표시·레이트리밋에 쓴다.
 *
 * `x-forwarded-for` 는 "client, proxy1, proxy2" 인데 **왼쪽은 클라이언트가 마음대로 넣을 수 있다** — 신뢰할 수 있는 것은
 * 우리 앞의 프록시가 *덧붙인* 오른쪽 값들이다. 그래서 오른쪽에서 TRUSTED_PROXY_HOPS(기본 0)개를 건너뛴 값을 클라이언트 IP 로 본다.
 * App Hosting(Cloud Run) 은 클라이언트 IP 를 맨 오른쪽에 붙인다 → 기본값 0. 앞에 CDN 이 하나 더 있으면 1 로 올린다.
 * 파싱 실패는 null — 호출자(레이트리밋)는 null 을 "알 수 없음" 버킷으로 다뤄야 한다 (건너뛰면 헤더 한 줄로 제한이 사라진다).
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;

function parseIp(raw: string): string | null {
  let ip = raw.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (IPV4.test(ip)) return ip.split(".").every((o) => Number(o) <= 255) ? ip : null;
  if (IPV6.test(ip) && ip.includes(":") && ip.length <= 45) return ip;
  return null;
}

/** XFF 목록에서 클라이언트 IP. hops = 우리 앞의 신뢰 프록시 수 (오른쪽에서 그만큼 건너뛴다) */
export function normalizeIp(raw: string | null | undefined, hops = trustedHops()): string | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const idx = parts.length - 1 - hops;
  if (idx < 0) return null;
  return parseIp(parts[idx]);
}

function trustedHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

export type RequestMeta = { ip: string | null; userAgent: string | null };

export function requestMeta(headers: Headers): RequestMeta {
  const ua = headers.get("user-agent");
  return {
    ip: normalizeIp(headers.get("x-forwarded-for") ?? headers.get("x-real-ip")),
    userAgent: ua ? ua.slice(0, 512) : null,
  };
}

/** UA 를 "Chrome · macOS" 식의 짧은 라벨로. 기기 목록 표시용 — 정확도보다 짧음이 우선. */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua) && /Version\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "브라우저";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "기기";
  return `${browser} · ${os}`;
}
