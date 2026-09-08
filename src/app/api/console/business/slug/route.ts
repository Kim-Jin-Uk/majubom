import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, HttpError, requireOwner } from "@/features/auth/guards";
import { changeSlug, slugSchema } from "@/features/business/settings";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

const Body = z.object({ slug: slugSchema });

/** PATCH /api/console/business/slug — 공개 URL 주소 변경 (OWNER). 옛 주소는 영구 예약된다 */
export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { slug } = await readJson(req, Body);
  const r = await changeSlug(v.membership.businessId, slug, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers));
  if (!r.ok) throw new HttpError(r.reason === "LIMIT" ? 429 : r.reason === "SAME" ? 400 : 409, `SLUG_${r.reason}`);
  return NextResponse.json({ ok: true, slug: r.slug });
});
