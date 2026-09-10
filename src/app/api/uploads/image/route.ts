import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, HttpError, requireConsole } from "@/features/auth/guards";
import { ImageError, MAX_IMAGE_BYTES, processImage } from "@/lib/storage/image";
import { buildImageBase, BUSINESS_IMAGE_QUOTA_BYTES, publicUrl, putVariant, usedBytes } from "@/lib/storage/r2";
import { variantKey } from "@/lib/storage/variants";

/**
 * POST /api/uploads/image   (multipart/form-data: kind, businessId, file)
 *   → { url, base, widths, bytes, used, quota }
 *
 * 브라우저가 R2 에 직접 PUT 하던 presign 방식을 대신한다 (#9 · L-40). 서버가 바이트를 보는 김에
 * 형식을 실제로 확인하고, EXIF(GPS)를 떼고, 사업장 한도를 **올리기 전에** 센다.
 *
 * 인가 (08 §2 보안): 그 사업장의 OWNER/MANAGER (`editProduct`). 타 사업장 id 는 404 — 존재를 노출하지 않는다.
 * 손님이 올리는 사진(리뷰 #92 · 채팅 #119)은 여기로 받지 않는다. 그쪽은 사업장 한도가 아니라
 * **사용자당 일 30장·100MB**(FR-CHAT-020)라 다른 계량이 필요하고, 그 표가 아직 없다.
 * 로그인만으로 남의 사업장 접두사에 파일을 쓸 수 있게 열어 두면 그 자체가 구멍이다.
 */
export const runtime = "nodejs";
/** 5MB 바이트를 받아 여러 장을 다시 그린다 — 기본 15초로는 큰 사진에서 잘린다 */
export const maxDuration = 60;

const Fields = z.object({
  kind: z.enum(["product", "gallery", "logo", "cover"]),
  businessId: z.uuid(),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);

  // **몸통을 읽기 전에** 인가부터 한다. 5MB 를 받아 놓고 401 을 돌려주면, 로그인 없이도 우리 대역폭을 쓸 수 있다.
  // businessId 는 폼 안에 있으므로 소속·권한만 먼저 보고, 사업장 일치는 파싱 직후에 본다
  const { membership } = await requireConsole({ permission: "editProduct" });

  // `formData()` 는 몸통을 끝까지 읽는다 — 크기 판정은 그전에 헤더로 한다. 여유분은 multipart 경계·필드 몫
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, "TOO_LARGE", { message: `사진은 장당 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 까지예요` });

  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "INVALID_BODY", { message: "multipart/form-data 가 아니다" });
  const parsed = Fields.safeParse({ kind: form.get("kind"), businessId: form.get("businessId") });
  if (!parsed.success) throw new HttpError(400, "INVALID_BODY", { issues: parsed.error.issues });
  const { kind, businessId } = parsed.data;
  // 타 사업장 id 는 403 이 아니라 404 — 존재를 노출하지 않는다 (08 §2)
  if (businessId !== membership.businessId) throw new HttpError(404, "NOT_FOUND");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "INVALID_BODY", { message: "file 이 없다" });
  // 바이트를 메모리에 올리기 전에 크기를 본다. processImage 도 다시 검사하지만, 여기서 막으면 5MB 를 읽지도 않는다
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "TOO_LARGE", { message: `사진은 장당 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 까지예요` });

  let used: number;
  try {
    used = await usedBytes(businessId);
  } catch (e) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", { message: (e as Error).message });
  }
  // 아직 몇 바이트가 될지는 다시 그려 봐야 알지만, 이미 꽉 찼으면 CPU 를 쓸 이유가 없다
  if (used >= BUSINESS_IMAGE_QUOTA_BYTES) throw new HttpError(413, "QUOTA_EXCEEDED", { used, quota: BUSINESS_IMAGE_QUOTA_BYTES });

  let image;
  try {
    image = await processImage(new Uint8Array(await file.arrayBuffer()), kind);
  } catch (e) {
    if (e instanceof ImageError) throw new HttpError(e.code === "TOO_LARGE" ? 413 : 415, e.code, { message: e.message });
    throw e;
  }
  if (used + image.totalBytes > BUSINESS_IMAGE_QUOTA_BYTES) throw new HttpError(413, "QUOTA_EXCEEDED", { used, quota: BUSINESS_IMAGE_QUOTA_BYTES });

  const base = buildImageBase(kind, businessId);
  const keys = image.variants.map((v) => variantKey(base, v.width));
  try {
    await Promise.all(image.variants.map((v, i) => putVariant(keys[i], v.body)));
  } catch (e) {
    // 일부만 올라갔을 수 있다. 화면이 가리키는 건 가장 큰 것 하나뿐인데 그게 없으면 깨진 사진이 남는다 —
    // 저장하지 않고 실패로 돌려주고, 남은 조각은 접두사가 참조되지 않으므로 보존 배치가 걷어 간다
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", { message: (e as Error).message });
  }

  const widths = image.variants.map((v) => v.width);
  return NextResponse.json({
    // 화면이 저장하는 건 **가장 큰 것**의 URL 하나. 나머지 폭은 URL 규약으로 되찾는다 (`variants.ts`)
    url: publicUrl(keys[keys.length - 1]),
    base,
    widths,
    bytes: image.totalBytes,
    used: used + image.totalBytes,
    quota: BUSINESS_IMAGE_QUOTA_BYTES,
  });
});
