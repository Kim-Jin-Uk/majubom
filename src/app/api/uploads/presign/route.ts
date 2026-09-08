import { NextResponse } from "next/server";
import { z } from "zod";
import { presignUpload, IMAGE_MIME, MAX_IMAGE_BYTES } from "@/lib/storage/r2";

/**
 * POST /api/uploads/presign
 * body: { kind, businessId, mime, bytes }  →  { key, url, publicUrl, expiresIn }
 *
 * TODO(#16 인증): 로그인 + 사업장 스코프 검사(businessId 소속 OWNER/MANAGER, 고객은 review·chat 만).
 *   인증 없이는 절대 배포하지 않는다 — 지금은 GATE 뒤에서 개발용으로만 동작한다.
 */
const Body = z.object({
  kind: z.enum(["product", "gallery", "review", "chat", "logo", "cover"]),
  businessId: z.uuid(),
  mime: z.enum(IMAGE_MIME),
  bytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(await presignUpload(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED", message: (e as Error).message }, { status: 503 });
  }
}
