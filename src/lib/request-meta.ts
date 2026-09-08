/**
 * 요청 메타 (IP · User-Agent). 감사 로그·세션 기기 표시·레이트리밋에 쓴다.
 *
 * App Hosting(Cloud Run) 앞단 프록시가 `x-forwarded-for` 에 "client, proxy1, proxy2" 를 넣는다 — 첫 값이 클라이언트.
 * 로컬(next dev)에서는 헤더가 없어 null 이 된다. inet 컬럼에 넣기 전에 형식을 검증한다 — 조작된 헤더로
 * INSERT 가 깨지면 로그인 자체가 실패하므로, 이상하면 조용히 null 로 떨어뜨린다.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.split(",")[0].trim();
  // "::ffff:1.2.3.4" (IPv4-mapped) 는 IPv4 로
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (IPV4.test(ip)) {
    return ip.split(".").every((o) => Number(o) <= 255) ? ip : null;
  }
  if (IPV6.test(ip) && ip.includes(":") && ip.length <= 45) return ip;
  return null;
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
