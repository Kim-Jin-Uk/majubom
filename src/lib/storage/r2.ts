/**
 * Cloudflare R2 (S3 호환) — 이미지 저장소.
 *
 * 업로드는 **브라우저 → 우리 API → R2** 다. 예전에는 presigned PUT 으로 브라우저가 R2 에 직접 올렸는데,
 * 업로드 시 리사이즈(L-40 · #9)를 하려면 서버가 바이트를 봐야 한다. 서버를 거치면서 얻은 것:
 * 형식을 바이트로 확인하고, EXIF(GPS)를 떼고, 사업장당 100MB 한도를 올리기 **전에** 셀 수 있다.
 *
 * 공개 URL 은 R2_PUBLIC_BASE_URL (1기: r2.dev 개발 URL / 2기: media.majubom.kr 커스텀 도메인).
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { VARIANT_MIME, type ImageKind } from "./variants";

export { MAX_IMAGE_BYTES, IMAGE_MIME, type ImageMime } from "./image";
export type { ImageKind };

/** 사업장당 이미지 총량 (기획서 §운영 한도 · FR-ADM-030 · FR-SITE-030) */
export const BUSINESS_IMAGE_QUOTA_BYTES = 100 * 1024 * 1024;

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
 * 한 장의 원본이 차지하는 접두사: `{businessId}/{kind}/{yyyy}/{mm}/{uuid}`.
 * variants 는 그 아래에 `{width}.webp` 로 놓인다 (`variants.ts` 의 규약과 한 쌍이다).
 */
export function buildImageBase(kind: ImageKind, businessId: string, now = new Date()): string {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new Error("businessId 는 uuid 여야 한다");
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${businessId}/${kind}/${y}/${m}/${randomUUID()}`;
}

export function publicUrl(key: string): string {
  return `${env("R2_PUBLIC_BASE_URL").replace(/\/$/, "")}/${key}`;
}

/** 키가 uuid+폭이라 내용이 절대 바뀌지 않는다 → 영구 캐시 */
export async function putVariant(key: string, body: Buffer): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      Body: body,
      ContentType: VARIANT_MIME,
      ContentLength: body.byteLength,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/**
 * 사업장이 지금 쓰고 있는 바이트. **별도 장부를 두지 않는다** — 키 맨 앞이 사업장이라
 * 접두사 스캔 한 번이면 되고, 지운 만큼 자동으로 줄어든다. 장부를 따로 두면 R2 와 어긋나는 날이 온다.
 *
 * 한도(100MB)를 훨씬 넘도록 페이지를 넘기지는 않는다 — 한도 판정에 필요한 건 "넘었는가" 뿐이다.
 */
export async function usedBytes(businessId: string, stopAt = BUSINESS_IMAGE_QUOTA_BYTES): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new Error("businessId 는 uuid 여야 한다");
  let total = 0;
  let token: string | undefined;
  do {
    const page = await r2().send(new ListObjectsV2Command({ Bucket: env("R2_BUCKET"), Prefix: `${businessId}/`, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of page.Contents ?? []) total += o.Size ?? 0;
    if (total >= stopAt) return total;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return total;
}

export async function deleteObject(key: string) {
  await r2().send(new DeleteObjectCommand({ Bucket: env("R2_BUCKET"), Key: key }));
}

export async function objectExists(key: string) {
  try { await r2().send(new HeadObjectCommand({ Bucket: env("R2_BUCKET"), Key: key })); return true; }
  catch { return false; }
}
