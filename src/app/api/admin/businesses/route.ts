import { NextResponse } from "next/server";
import { handle, HttpError, requireAdmin } from "@/features/auth/guards";
import { listBusinesses, listQuerySchema } from "@/features/admin/businesses";

/** GET /api/admin/businesses?status&q — 심사가 끝난 사업장 (FR-ADM-020) */
export const GET = handle(async (req) => {
  await requireAdmin();
  const u = new URL(req.url);
  const parsed = listQuerySchema.safeParse({ status: u.searchParams.get("status") ?? undefined, q: u.searchParams.get("q") ?? undefined });
  if (!parsed.success) throw new HttpError(400, "INVALID_QUERY", { issues: parsed.error.issues });
  return NextResponse.json({ businesses: await listBusinesses(parsed.data) });
});
