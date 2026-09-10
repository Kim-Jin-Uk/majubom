import sharp from "sharp";
import { plannedWidths, VARIANT_MIME, type ImageKind } from "./variants";

/**
 * 업로드된 이미지를 **서버에서 다시 그린다** (L-40 · #9).
 *
 * Cloudflare Images(유료)도, `next/image` 옵티마이저(우리 Cloud Run CPU 를 매 요청 태운다)도 쓰지 않는다.
 * 업로드 한 번에 variants 를 만들어 R2 에 같이 올리고, 그 뒤로는 R2 가 정적 파일을 뱉을 뿐이다.
 *
 * 다시 그리는 김에 얻는 것들이 오히려 더 중요하다:
 * - **원본을 보관하지 않는다.** 손님이 올린 리뷰 사진의 EXIF 에는 GPS 가 들어 있다. sharp 는 기본적으로
 *   메타데이터를 버리므로, 다시 그린 파일에는 촬영 위치·기기·시각이 남지 않는다
 * - **바이트를 실제로 해석한다.** presigned PUT 시절에는 `image/webp` 로 서명받고 HTML 을 올릴 수 있었다.
 *   여기서는 디코딩에 실패하면 그냥 거절된다
 * - 사업장당 100MB 한도가 원본 크기가 아니라 **우리가 정한 크기**로 소비된다
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — FR-PRD-010 · FR-CHAT-020
/** 압축 폭탄 방어. 5MB png 로 1억 픽셀을 만들 수 있다 — 디코딩 전에 막는다 */
export const MAX_SOURCE_PIXELS = 40_000_000;
const WEBP_QUALITY = 82;

export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * 확장자·Content-Type 이 아니라 **바이트 앞머리**로 형식을 정한다.
 * 브라우저가 보내는 `file.type` 은 파일명에서 추측한 값이라 그대로 믿을 수 없다.
 */
export function sniffMime(b: Uint8Array): ImageMime | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
  if (ascii(b, 4, "ftyp") && (ascii(b, 8, "avif") || ascii(b, 8, "avis"))) return "image/avif";
  return null;
}

export type Variant = { width: number; body: Buffer; bytes: number };
export type ProcessedImage = { mime: ImageMime; sourceWidth: number; sourceHeight: number; variants: Variant[]; totalBytes: number };

export class ImageError extends Error {
  constructor(readonly code: "BAD_TYPE" | "TOO_LARGE" | "UNREADABLE", message: string) {
    super(message);
  }
}

/**
 * 원본 바이트 → 그 kind 의 variants. 만들어진 것 중 **가장 큰 것이 정본**이다(원본은 버린다).
 *
 * `.rotate()` 를 먼저 부르는 이유: 폰 사진은 세로로 찍어도 가로 픽셀 + EXIF 회전값으로 저장된다.
 * 메타데이터를 버리면서 회전만 적용하지 않으면 갤러리가 통째로 눕는다.
 */
export async function processImage(input: Uint8Array, kind: ImageKind): Promise<ProcessedImage> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageError("TOO_LARGE", `사진은 장당 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 까지예요`);
  const mime = sniffMime(input);
  if (!mime) throw new ImageError("BAD_TYPE", "JPG · PNG · WebP · AVIF 만 올릴 수 있어요");

  const pipeline = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS, animated: false }).rotate();
  let width: number, height: number;
  try {
    const meta = await pipeline.metadata();
    // autoOrient 는 EXIF 회전을 반영한 크기다. 이걸 안 쓰면 세로 사진의 폭을 높이로 잘못 읽는다
    width = meta.autoOrient?.width ?? meta.width ?? 0;
    height = meta.autoOrient?.height ?? meta.height ?? 0;
  } catch (e) {
    throw new ImageError("UNREADABLE", `이미지를 읽지 못했어요: ${(e as Error).message}`);
  }
  if (width <= 0 || height <= 0) throw new ImageError("UNREADABLE", "이미지 크기를 읽지 못했어요");

  const variants: Variant[] = [];
  try {
    for (const w of plannedWidths(kind, width)) {
      // clone 으로 디코딩 한 번을 나눠 쓴다. 매번 sharp(input) 을 새로 만들면 폭마다 원본을 다시 푼다
      const body = await pipeline.clone().resize({ width: w, withoutEnlargement: true, fit: "inside" }).webp({ quality: WEBP_QUALITY }).toBuffer();
      variants.push({ width: w, body, bytes: body.byteLength });
    }
  } catch (e) {
    // 헤더는 멀쩡한데 픽셀에서 깨지는 파일, 그리고 limitInputPixels 초과가 여기서 터진다.
    // 500 으로 흘려보내면 "처리 중 문제가 생겼습니다" 만 뜨고 손님은 왜 안 되는지 모른다
    throw new ImageError("UNREADABLE", `이미지를 처리하지 못했어요: ${(e as Error).message}`);
  }
  return { mime, sourceWidth: width, sourceHeight: height, variants, totalBytes: variants.reduce((s, v) => s + v.bytes, 0) };
}

export { VARIANT_MIME };
