/**
 * Cloudflare R2 (S3 호환) — 이미지 저장소.
 *
 * 업로드는 브라우저 → R2 직접 (presigned PUT). 서버는 URL 만 발급한다.
 * 공개 URL 은 R2_PUBLIC_BASE_URL (1기: r2.dev 개발 URL / 2기: media.majubom.kr 커스텀 도메인).
 * 리사이즈는 1기엔 next/image 옵티마이저, 커스텀 도메인이 붙으면 Cloudflare Image Transformations 로 교체 (#9).
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — FR-PRD-010 · FR-CHAT-020

export type ImageKind = "product" | "gallery" | "review" | "chat" | "logo" | "cover";

const EXT: Record<ImageMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 이 설정돼 있지 않다`);
  if (name === "R2_ACCOUNT_ID" && !/^[0-9a-f]{32}$/.test(v)) {
    throw new Error("R2_ACCOUNT_ID 는 32자 hex 다. cfat_… 토큰 값이 들어가 있다면 자리가 틀렸다 — S3 엔드포인트 https://<ACCOUNT_ID>.r2.cloudflarestorage.com 의 앞부분");
  }
  if (name === "R2_PUBLIC_BASE_URL" && /r2\.cloudflarestorage\.com/.test(v)) {
    throw new Error("R2_PUBLIC_BASE_URL 에 S3 엔드포인트가 들어가 있다 — 버킷 Settings → Public Development URL (https://pub-….r2.dev) 이어야 한다");
  }
  if (name === "R2_SECRET_ACCESS_KEY" && !/^[0-9a-f]{64}$/.test(v)) {
    throw new Error("R2_SECRET_ACCESS_KEY 는 64자 hex 다. 토큰 화면의 'Secret Access Key' 값 (cfat_ 토큰 값이 아니다)");
  }
  return v;
}

let client: S3Client | undefined;
export function r2() {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
  return client;
}

/**
 * 객체 키 규약: `{kind}/{businessId}/{yyyy}/{mm}/{uuid}.{ext}`
 * - 사업장별 접두사 → 사업장 삭제·용량 집계(사업장당 100MB, FR-ADM-030)가 prefix 스캔 한 번
 * - 월 폴더 → 보존 배치(FR-PRIV-010)가 오래된 접두사만 훑는다
 * - 파일명은 uuid — 원본 파일명(개인정보 가능)을 키에 남기지 않는다
 */
export function buildObjectKey(kind: ImageKind, businessId: string, mime: ImageMime, now = new Date()): string {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new Error("businessId 는 uuid 여야 한다");
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${kind}/${businessId}/${y}/${m}/${randomUUID()}.${EXT[mime]}`;
}

export function publicUrl(key: string): string {
  return `${env("R2_PUBLIC_BASE_URL").replace(/\/$/, "")}/${key}`;
}

/** 브라우저가 R2 에 직접 PUT 할 수 있는 URL. 10분 유효. Content-Type·크기는 서명에 묶인다. */
export async function presignUpload(opts: { kind: ImageKind; businessId: string; mime: ImageMime; bytes: number }) {
  if (!IMAGE_MIME.includes(opts.mime)) throw new Error(`허용되지 않는 형식: ${opts.mime}`);
  if (opts.bytes <= 0 || opts.bytes > MAX_IMAGE_BYTES) throw new Error(`크기 한도 초과 (${MAX_IMAGE_BYTES} bytes)`);
  const key = buildObjectKey(opts.kind, opts.businessId, opts.mime);
  const cmd = new PutObjectCommand({
    Bucket: env("R2_BUCKET"),
    Key: key,
    ContentType: opts.mime,
    ContentLength: opts.bytes,
    CacheControl: "public, max-age=31536000, immutable", // 키가 uuid 라 영구 캐시 안전
  });
  // content-type 을 서명에 포함시킨다. 기본 서명은 content-length·host 만 묶어서,
  // 클라이언트가 image/webp 로 서명받고 실제로는 text/html 을 올릴 수 있다.
  const url = await getSignedUrl(r2(), cmd, {
    expiresIn: 600,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { key, url, publicUrl: publicUrl(key), expiresIn: 600 };
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: env("R2_BUCKET"), Key: key }));
}

export async function objectExists(key: string) {
  try { await r2().send(new HeadObjectCommand({ Bucket: env("R2_BUCKET"), Key: key })); return true; }
  catch { return false; }
}
