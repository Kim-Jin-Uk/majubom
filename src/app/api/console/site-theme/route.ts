import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";
import { revalidatePublicHome } from "@/features/site/revalidate";
import { getSiteColorScheme, siteThemeSchema, updateSiteColorScheme } from "@/features/site/theme-settings";

/** GET /api/console/site-theme — 공개 홈 밝기 · PUT — 변경 (OWNER, #76 · 01 §10) */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ colorScheme: await getSiteColorScheme(v.membership.businessId) });
});

export const PUT = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { colorScheme } = await readJson(req, siteThemeSchema);
  const { changed } = await updateSiteColorScheme(v.membership.businessId, colorScheme, { uid: v.uid, role: v.membership.role }, requestMeta(req.headers));
  // 밝기는 첫 페인트 전에 서버가 심는 값이라, 무효화하지 않으면 CDN·Next 캐시가 옛 밝기를 계속 내보낸다
  if (changed) await revalidatePublicHome(v.membership.businessId);
  return NextResponse.json({ ok: true, colorScheme });
});
