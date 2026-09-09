/**
 * 공개 홈의 주소 규칙. 순수 함수 — 프록시가 이것만 보고 rewrite 를 정한다.
 *
 * 손님이 보는 주소는 `/@{slug}` 이고 렌더는 내부 경로 `/site/{slug}` 가 맡는다.
 * 최상위에 `app/[handle]` 을 두면 정의되지 않은 **모든** 최상위 경로를 그 라우트가 삼키기 때문이다.
 */

/** businesses_slug_format CHECK 와 같은 모양. 여기서 한 번 더 보는 이유는 아래 주석 참고 */
const SLUG = /^[a-z0-9-]{3,30}$/;

export const SITE_PREFIX = "/site/";

export const isPublicHome = (pathname: string): boolean => pathname.startsWith("/@");

/**
 * `/@{slug}` → `/site/{slug}`. 모양이 slug 가 아니면 **rewrite 하지 않는다**(null).
 *
 * 검증을 빼면 `new URL("/site/" + "../admin", base)` 가 `/admin` 으로 정규화된다 —
 * 공개 주소 한 줄로 내부 경로에 들어가는 길이 열린다. DB 가 어차피 못 찾을 값이라도 여기서 먼저 끊는다.
 */
export function internalSitePath(pathname: string): string | null {
  if (!isPublicHome(pathname)) return null;
  const slug = pathname.slice(2);
  return SLUG.test(slug) ? `${SITE_PREFIX}${slug}` : null;
}
