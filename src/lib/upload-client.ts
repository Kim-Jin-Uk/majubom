"use client";

import { describeError } from "@/lib/client-api";

export type UploadKind = "product" | "gallery" | "logo" | "cover";
export type UploadResult = { ok: true; url: string; widths: number[]; used: number; quota: number } | { ok: false; error: string; message?: string };

const MAX_BYTES = 5 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * 이미지 업로드: 파일을 우리 API 로 보내면 서버가 sharp 로 여러 크기를 만들어 R2 에 올리고
 * **가장 큰 것의 URL** 을 돌려준다 (#9 · L-40). 화면은 그 URL 하나만 저장하면 되고,
 * 작은 크기는 `imageSrcSet` 이 URL 규약으로 되찾는다.
 *
 * R2 env 가 없는 로컬에서는 503 STORAGE_NOT_CONFIGURED — 화면이 URL 직접 입력으로 안내한다.
 * 여기서 `apiPost` 를 쓰지 않는 이유는 FormData 를 보내야 하기 때문이다 (경계 문자열은 브라우저가 정한다).
 */
export async function uploadImage(file: File, kind: UploadKind, businessId: string): Promise<UploadResult> {
  if (!MIMES.includes(file.type)) return { ok: false, error: "BAD_TYPE", message: "JPG · PNG · WebP · AVIF 만 올릴 수 있어요" };
  if (file.size > MAX_BYTES) return { ok: false, error: "TOO_LARGE", message: "사진은 장당 5MB 까지예요" };

  const body = new FormData();
  body.set("kind", kind);
  body.set("businessId", businessId);
  body.set("file", file);

  let res: Response;
  try {
    res = await fetch("/api/uploads/image", { method: "POST", body, credentials: "same-origin" });
  } catch {
    return { ok: false, error: "NETWORK", message: "네트워크 연결을 확인해 주세요" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, url: String(data.url), widths: (data.widths as number[]) ?? [], used: Number(data.used ?? 0), quota: Number(data.quota ?? 0) };

  const error = typeof data.error === "string" ? data.error : `HTTP_${res.status}`;
  const message = typeof data.message === "string" ? data.message : undefined;
  if (error === "STORAGE_NOT_CONFIGURED") return { ok: false, error, message: "이 환경에는 이미지 저장소가 연결돼 있지 않아요" };
  if (error === "QUOTA_EXCEEDED") return { ok: false, error, message: "사업장 사진 용량(100MB)이 다 찼어요. 쓰지 않는 사진을 지운 뒤 다시 올려 주세요" };
  if (error === "UNREADABLE") return { ok: false, error, message: message ?? "사진 파일이 손상된 것 같아요" };
  return { ok: false, error, message: message ?? describeError({ error }) };
}
