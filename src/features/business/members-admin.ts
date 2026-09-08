import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businessMembers, resources, users, type MemberPermissions } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { PERMISSION_KEYS, normalizePermissions } from "@/features/auth/members";
import { revokeAllSessions } from "@/features/auth/session-store";
import { writeAudit } from "@/lib/audit";
import { revokeFirebaseAccess } from "@/lib/firebase/admin";
import { flags } from "@/lib/flags";
import type { RequestMeta } from "@/lib/request-meta";

/**
 * 매니저 권한 관리 · 비활성화 (#30, 02 §2.2 BusinessMember). OWNER 전용.
 * - permissions 는 4키 고정, 목록에 없는 키는 저장 시 무시(normalizePermissions)
 * - 비활성화(INACTIVE): 리프레시 토큰 전부 폐기(FR-AUTH-030 무효화 표) + Firebase 리프레시 폐기 + MEMBER_DEACTIVATE 감사.
 *   콘솔 프록시는 매 요청 memberStatus 를 보므로 그 즉시 콘솔이 닫힌다. 연결된 STAFF 자원은 남기되 비활성화(기존 예약 유지)
 * - OWNER 자신은 대상이 아니다 (이양은 2기)
 */
export const permissionsSchema = z.partialRecord(z.enum(PERMISSION_KEYS), z.boolean());

async function loadManager(businessId: string, memberId: string) {
  const [m] = await db
    .select({ id: businessMembers.id, userId: businessMembers.userId, role: businessMembers.role, status: businessMembers.status, permissions: businessMembers.permissions })
    .from(businessMembers)
    .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, businessId)))
    .limit(1);
  if (!m) throw new HttpError(404, "NOT_FOUND");
  if (m.role !== "MANAGER") throw new HttpError(403, "OWNER_NOT_EDITABLE");
  return m;
}

export async function updateMemberPermissions(businessId: string, memberId: string, input: Record<string, unknown>, actor: { uid: string }, meta: RequestMeta): Promise<MemberPermissions> {
  const m = await loadManager(businessId, memberId);
  const next = normalizePermissions(input);
  const before = m.permissions ?? {};
  const diff: Record<string, { from: boolean; to: boolean }> = {};
  for (const k of PERMISSION_KEYS) if (Boolean(before[k]) !== Boolean(next[k])) diff[k] = { from: Boolean(before[k]), to: Boolean(next[k]) };
  if (Object.keys(diff).length === 0) return before;
  await db.transaction(async (tx) => {
    await tx.update(businessMembers).set({ permissions: next }).where(eq(businessMembers.id, memberId));
    await writeAudit({ action: "MEMBER_PERMISSION_UPDATE", actorId: actor.uid, actorRole: "OWNER", businessId, targetType: "BUSINESS_MEMBER", targetId: memberId, diff, meta }, tx);
  });
  return next;
}

export async function setMemberActive(businessId: string, memberId: string, active: boolean, actor: { uid: string }, meta: RequestMeta): Promise<void> {
  const m = await loadManager(businessId, memberId);
  if (active) {
    if (m.status !== "INACTIVE") throw new HttpError(409, "NOT_INACTIVE");
    await db.update(businessMembers).set({ status: "ACTIVE" }).where(eq(businessMembers.id, memberId));
    return;
  }
  if (m.status === "INACTIVE") return;
  await db.transaction(async (tx) => {
    await tx.update(businessMembers).set({ status: "INACTIVE" }).where(eq(businessMembers.id, memberId));
    await tx.update(resources).set({ isActive: false }).where(eq(resources.memberId, memberId));
    await revokeAllSessions(m.userId, undefined, tx);
    await writeAudit({ action: "MEMBER_DEACTIVATE", actorId: actor.uid, actorRole: "OWNER", businessId, targetType: "BUSINESS_MEMBER", targetId: memberId, diff: { status: { from: m.status, to: "INACTIVE" } }, meta }, tx);
  });
  if (flags.chat) await revokeFirebaseAccess(m.userId).catch((e) => console.error("[members-admin] firebase revoke failed:", (e as Error).message));
}

/** 구성원 상세 (권한 편집 화면) */
export async function getMember(businessId: string, memberId: string) {
  const [m] = await db
    .select({ id: businessMembers.id, role: businessMembers.role, status: businessMembers.status, permissions: businessMembers.permissions, name: users.name })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, businessId)))
    .limit(1);
  if (!m) throw new HttpError(404, "NOT_FOUND");
  return { ...m, permissions: m.permissions ?? {} };
}
