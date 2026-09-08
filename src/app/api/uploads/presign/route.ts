import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { handle, HttpError, requireConsole, requireUser } from "@/features/auth/guards";
import { presignUpload, IMAGE_MIME, MAX_IMAGE_BYTES } from "@/lib/storage/r2";

/**
 * POST /api/uploads/presign
 * body: { kind, businessId, mime, bytes }  →  { key, url, publicUrl, expiresIn }
 *
 * 인가 (08 §2 보안):
 * - product · gallery · logo · cover: 그 사업장의 OWNER/MANAGER (editProduct 권한). 타 사업장은 404
 * - review · chat: 로그인한 고객 누구나 (해당 사업장의 존재 여부는 노출하지 않는다 — 실제 사용 시점에 예약·방 소속을 검사)
 */
const Body = z.object({
  kind: z.enum(["product", "gallery", "review", "chat", "logo", "cover"]),
  businessId: z.uuid(),
  mime: z.enum(IMAGE_MIME),
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "INVALID_BODY", { issues: parsed.error.issues });
  const { kind, businessId } = parsed.data;
  if (kind === "review" || kind === "chat") await requireUser();
  else await requireConsole({ businessId, permission: "editProduct" });
  try {
    return NextResponse.json(await presignUpload(parsed.data));
  } catch (e) {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", { message: (e as Error).message });
  }
});
