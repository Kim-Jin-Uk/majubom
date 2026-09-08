"use client";

import { apiPost } from "@/lib/client-api";

export type UploadKind = "product" | "gallery" | "logo" | "cover" | "review" | "chat";
export type UploadResult = { ok: true; url: string } | { ok: false; error: "STORAGE_NOT_CONFIGURED" | "TOO_LARGE" | "BAD_TYPE" | "UPLOAD_FAILED" | string; message?: string };

const MAX_BYTES = 5 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * 이미지 업로드: presign(우리 API) → 브라우저가 R2 에 직접 PUT → 공개 URL. 서버는 파일 바이트를 만지지 않는다.
 * R2 env 가 없는 로컬에서는 503 STORAGE_NOT_CONFIGURED — 화면이 URL 직접 입력으로 안내한다.
 */
export async function uploadImage(file: File, kind: UploadKind, businessId: string): Promise<UploadResult> {
  if (!MIMES.includes(file.type)) return { ok: false, error: "BAD_TYPE", message: "JPG · PNG · WebP · AVIF 만 올릴 수 있어요" };
  if (file.size > MAX_BYTES) return { ok: false, error: "TOO_LARGE", message: "사진은 장당 5MB 까지예요" };
  const r = await apiPost<{ url: string; publicUrl: string }>("/api/uploads/presign", { kind, businessId, mime: file.type, bytes: file.size });
  if (!r.ok) return { ok: false, error: r.error, message: r.error === "STORAGE_NOT_CONFIGURED" ? "이 환경에는 이미지 저장소가 연결돼 있지 않아요" : r.message };
  try {
    const put = await fetch(r.data.url, { method: "PUT", body: file, headers: { "content-type": file.type } });
    if (!put.ok) return { ok: false, error: "UPLOAD_FAILED", message: `업로드 실패 (${put.status})` };
  } catch {
    return { ok: false, error: "UPLOAD_FAILED", message: "네트워크 연결을 확인해 주세요" };
  }
  return { ok: true, url: r.data.publicUrl };
}
