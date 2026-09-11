/**
 * 이미지 variants — **이름 규칙 하나로 크기 세트를 되찾는다.**
 *
 * 업로드 때 sharp 가 만든 파일들은 `…/{uuid}/{width}.webp` 로 나란히 놓인다(L-40).
 * DB 에는 그중 **가장 큰 것의 URL 하나만** 저장한다. 크기 목록을 따로 저장하지 않는 이유는,
 * 저장하는 순간 `products.images` · `resources.imageUrl` · 리뷰 · 채팅이 각자 형식을 갖게 되고
 * 사업자가 직접 붙여 넣은 외부 URL 과 섞이기 때문이다.
 *
 * 그래서 **URL 만 보고 형제 파일을 계산할 수 있게** 규칙을 짰다. 키에 kind 와 폭이 둘 다 들어 있고,
 * `plannedWidths` 는 "그 kind 의 표준 폭 중 원본보다 작은 것 + 원본(상한까지)" 이라, 저장된 폭 W 를
 * 알면 함께 만들어진 것이 무엇인지 유일하게 정해진다. 이 두 함수는 **같은 규칙의 양쪽**이므로
 * 한쪽만 고치면 깨진다 — 테스트가 왕복으로 묶어 둔다.
 */
export type ImageKind = "product" | "gallery" | "review" | "chat" | "logo" | "cover";
export const IMAGE_KINDS = ["product", "gallery", "review", "chat", "logo", "cover"] as const;

/**
 * kind 별 표준 폭. 화면에서 실제로 쓰이는 크기에서 나왔다 —
 * 로고는 헤더 아이콘, 커버는 전면 히어로, 나머지는 카드 썸네일(2배 화면 포함).
 */
export const IMAGE_WIDTHS: Record<ImageKind, readonly number[]> = {
  logo: [128, 256],
  cover: [640, 1280, 1920],
  product: [320, 640, 1280],
  gallery: [320, 640, 1280],
  review: [320, 640, 1280],
  chat: [320, 640, 1280],
};

/** 저장 형식은 webp 하나. avif 까지 만들면 파일 수·CPU 가 두 배인데, 사업장당 100MB 안에서 살아야 한다 */
export const VARIANT_EXT = "webp";
export const VARIANT_MIME = "image/webp";

/** 원본 폭이 이만큼도 안 되면 그 kind 의 최소 표준 폭 하나만 나온다 */
export function plannedWidths(kind: ImageKind, sourceWidth: number): number[] {
  const set = IMAGE_WIDTHS[kind];
  const cap = Math.min(sourceWidth, set[set.length - 1]);
  return [...new Set([...set.filter((w) => w < sourceWidth), cap])].sort((a, b) => a - b);
}

export const variantKey = (base: string, width: number): string => `${base}/${width}.${VARIANT_EXT}`;

/**
 * 키 규약: `{businessId}/{kind}/{yyyy}/{mm}/{uuid}/{width}.webp`
 * - **사업장이 맨 앞** — 용량 집계(사업장당 100MB)와 사업장 삭제가 접두사 하나로 끝난다
 * - 월 폴더 → 보존 배치(FR-PRIV-010)가 오래된 접두사만 훑는다
 * - 파일명은 uuid·폭뿐 — 원본 파일명(개인정보가 들어 있을 수 있다)을 키에 남기지 않는다
 */
const KEY_RE = new RegExp(`(?:^|/)([0-9a-f-]{36})/(${IMAGE_KINDS.join("|")})/(\\d{4})/(\\d{2})/([0-9a-f-]{36})/(\\d+)\\.${VARIANT_EXT}$`, "i");

export type ParsedImage = { base: string; kind: ImageKind; width: number };

/** 우리 R2 키 규약에 맞는 URL(또는 키)이면 갈라 준다. 사업자가 붙여 넣은 외부 URL 이면 null */
export function parseImageUrl(url: string): ParsedImage | null {
  const m = KEY_RE.exec(url);
  if (!m) return null;
  const width = Number(m[6]);
  if (!Number.isSafeInteger(width) || width <= 0) return null;
  return { base: url.slice(0, url.length - `/${m[6]}.${VARIANT_EXT}`.length), kind: m[2].toLowerCase() as ImageKind, width };
}

/** 저장된 URL 과 함께 만들어진 폭들. `plannedWidths` 의 역함수 */
export function siblingWidths(kind: ImageKind, storedWidth: number): number[] {
  return [...new Set([...IMAGE_WIDTHS[kind].filter((w) => w < storedWidth), storedWidth])].sort((a, b) => a - b);
}

/** `<img srcSet>` 용. 우리 것이 아니면 srcSet 없이 그대로 — 외부 URL 을 우리 규칙으로 조작하지 않는다 */
export function imageSrcSet(url: string): { src: string; srcSet?: string } {
  const p = parseImageUrl(url);
  if (!p) return { src: url };
  const ws = siblingWidths(p.kind, p.width);
  if (ws.length < 2) return { src: url };
  return { src: url, srcSet: ws.map((w) => `${variantKey(p.base, w)} ${w}w`).join(", ") };
}
