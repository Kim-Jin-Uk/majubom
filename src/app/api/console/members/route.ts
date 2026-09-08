import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/features/auth/csrf";
import { assertWritable, handle, requireConsole, requireOwner } from "@/features/auth/guards";
import { inviteManager, listMembers, normalizePermissions, PERMISSION_KEYS } from "@/features/auth/members";
import { emailSchema, nameSchema, phoneSchema } from "@/features/auth/validation";
import { readJson } from "@/lib/api";
import { requestMeta } from "@/lib/request-meta";

/** GET /api/console/members — 구성원 목록 (소속 멤버 누구나) · POST — 매니저 초대 (OWNER, FR-AUTH-020) */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json({ members: await listMembers(v.membership.businessId) });
});

const Body = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  permissions: z.partialRecord(z.enum(PERMISSION_KEYS), z.boolean()).optional(),
  /** 계정 없이 이름만 등록된 기존 STAFF 자원에 연결할 때 */
  resourceId: z.uuid().optional(),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  assertWritable(req);
  const v = await requireOwner();
  const body = await readJson(req, Body);
  const r = await inviteManager(
    v.membership.businessId,
    { uid: v.uid, name: v.principal.name },
    { name: body.name, email: body.email, phone: body.phone, permissions: normalizePermissions(body.permissions), resourceId: body.resourceId },
    requestMeta(req.headers),
  );
  return NextResponse.json({ ok: true, memberId: r.memberId }, { status: 201 });
});
