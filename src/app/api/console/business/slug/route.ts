import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, HttpError, requireOwner } from "@/features/auth/guards";
import { changeSlug, slugSchema } from "@/features/business/settings";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";
import { revalidatePublicHome, revalidateSitePath } from "@/features/site/revalidate";
import { publicHomePath } from "@/features/site/public-home";

const Body = z.object({ slug: slugSchema });

/** PATCH /api/console/business/slug — 공개 URL 주소 변경 (OWNER). 옛 주소는 영구 예약된다 */
export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { slug } = await readJson(req, Body);
  // 바꾸기 **전** 경로를 잡아 둔다 — 바꾼 뒤에 읽으면 새 경로만 알게 되고, 정작 옛 경로에 남은 캐시가
  // 301 대신 옛 페이지를 계속 내보낸다
  const before = await publicHomePath(v.membership.businessId);
  const r = await changeSlug(v.membership.businessId, slug, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers));
  if (!r.ok) throw new HttpError(r.reason === "LIMIT" ? 429 : r.reason === "SAME" ? 400 : 409, `SLUG_${r.reason}`);
  if (before) revalidateSitePath(before);
  await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true, slug: r.slug });
});
