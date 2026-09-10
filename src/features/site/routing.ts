/**
 * 공개 주소 규칙. 순수 함수 — 프록시가 이것만 보고 rewrite 를 정한다.
 *
 * 손님이 보는 주소는 `/@{slug}` 이고 렌더는 내부 경로 `/site/{slug}` 가 맡는다.
 * 최상위에 `app/[handle]` 을 두면 정의되지 않은 **모든** 최상위 경로를 그 라우트가 삼키기 때문이다.
 */

/** businesses_slug_format CHECK 와 같은 모양. 여기서 한 번 더 보는 이유는 아래 주석 참고 */
const SLUG = /^[a-z0-9-]{3,30}$/;

/**
 * slug 뒤에 올 수 있는 경로 조각. **점을 아예 안 받는다** — `.` 도 `..` 도 만들어질 수 없다.
 * 없는 조각으로 들어오면 Next 가 알아서 404 다(라우트가 없으므로).
 */
const SEGMENT = /^[a-z0-9_-]{1,64}$/i;

export const SITE_PREFIX = "/site/";

/** `/@…` 로 시작하는 모든 공개 주소 (홈 · 예약 위젯 …) */
export const isPublicPath = (pathname: string): boolean => pathname.startsWith("/@");

/** 정확히 `/@{slug}` — 사업장 홈 한 장. 공유 캐시에 올릴 수 있는 것은 이것뿐이다 */
export const isPublicHome = (pathname: string): boolean => internalSitePath(pathname)?.split("/").length === 3;

/**
 * `/@{slug}[/…]` → `/site/{slug}[/…]`. 모양이 맞지 않으면 **rewrite 하지 않는다**(null).
 *
 * 검증을 빼면 `new URL("/site/" + "../admin", base)` 가 `/admin` 으로 정규화된다 —
 * 공개 주소 한 줄로 내부 경로에 들어가는 길이 열린다. DB 가 어차피 못 찾을 값이라도 여기서 먼저 끊는다.
 */
export function internalSitePath(pathname: string): string | null {
  if (!isPublicPath(pathname)) return null;
  // 뒤에 붙은 `/` 는 버린다 — `/@shop/` 과 `/@shop` 이 다른 주소가 되면 색인이 갈린다
  const rest = pathname.slice(2).replace(/\/+$/, "");
  const [slug, ...tail] = rest.split("/");
  if (!SLUG.test(slug)) return null;
  if (!tail.every((s) => SEGMENT.test(s))) return null;
  return `${SITE_PREFIX}${[slug, ...tail].join("/")}`;
}

/** 손님에게 보여 줄 주소 (링크·canonical·301 목적지) */
export const publicHomeHref = (slug: string): string => `/@${slug}`;
export const bookingHref = (slug: string, productId?: string): string => `/@${slug}/book${productId ? `?product=${encodeURIComponent(productId)}` : ""}`;
