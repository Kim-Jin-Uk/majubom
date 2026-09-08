import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireOwner } from "@/features/auth/guards";
import { getMember, permissionsSchema, setMemberActive, updateMemberPermissions } from "@/features/business/members-admin";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

const Body = z
  .object({ permissions: permissionsSchema.optional(), active: z.boolean().optional() })
  .refine((b) => b.permissions !== undefined || b.active !== undefined, "permissions 또는 active 중 하나는 필요합니다");

/** GET /api/console/members/:id — 구성원 상세 · PATCH — 권한 변경 / 비활성·재활성 (OWNER, #30). OWNER 본인은 대상이 아니다(403) */
export const GET = handle(async (_req, ctx) => {
  const v = await requireOwner();
  const { id } = await ctx.params;
  return NextResponse.json({ member: await getMember(v.membership.businessId, id) });
});

export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const { id } = await ctx.params;
  const body = await readJson(req, Body);
  const meta = requestMeta(req.headers);
  let permissions;
  if (body.permissions !== undefined) permissions = await updateMemberPermissions(v.membership.businessId, id, body.permissions, { uid: v.uid }, meta);
  if (body.active !== undefined) await setMemberActive(v.membership.businessId, id, body.active, { uid: v.uid }, meta);
  return NextResponse.json({ ok: true, ...(permissions ? { permissions } : {}) });
});
