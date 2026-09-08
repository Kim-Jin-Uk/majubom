import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businessMembers, businesses, resources, users, type MemberPermissions } from "@/db/schema";
import { absoluteUrl } from "@/lib/api";
import { writeAudit, hashPii } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { inviteMail } from "@/lib/mail/templates";
import type { RequestMeta } from "@/lib/request-meta";
import { INVITE_TTL_HOURS } from "./constants";
import { hashPassword } from "./crypto";
import { HttpError } from "./errors";
import { consumeToken, issueToken, peekToken } from "./tokens";

/**
 * 매니저 초대 (FR-AUTH-020).
 * User(passwordHash=null) + BusinessMember(MANAGER, INVITED) + Resource(STAFF, memberId) 를 한 트랜잭션으로 만들고
 * 72시간 단일사용 링크를 메일로 보낸다. 임시 비밀번호는 만들지 않는다 — 사업자가 매니저로 로그인할 수 있으면 감사 로그의
 * 행위자 귀속이 무너진다. 계정 없이 이름만 등록된 STAFF 자원이 있으면 새로 만들지 않고 연결한다.
 */
export const PERMISSION_KEYS = ["editProduct", "replyReview", "viewAllReservations", "handleChat"] as const satisfies readonly (keyof MemberPermissions)[];

export function normalizePermissions(input: Record<string, unknown> | undefined): MemberPermissions {
  const out: MemberPermissions = {};
  for (const k of PERMISSION_KEYS) if (input?.[k] === true) out[k] = true;
  return out;
}

export type InviteInput = { name: string; email: string; phone?: string; permissions: MemberPermissions; resourceId?: string };

export async function inviteManager(businessId: string, inviter: { uid: string; name: string }, input: InviteInput, meta: RequestMeta) {
  const [biz] = await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new HttpError(404, "NOT_FOUND");

  const [existingUser] = await db.select({ id: users.id, passwordHash: users.passwordHash, status: users.status }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existingUser) {
    // 1계정 1사업장 — 이미 어느 사업장에든 속해 있으면 거절 (다중 소속은 P3)
    const [m] = await db.select({ id: businessMembers.id }).from(businessMembers).where(eq(businessMembers.userId, existingUser.id)).limit(1);
    if (m) throw new HttpError(409, "ALREADY_MEMBER");
    if (existingUser.status !== "ACTIVE") throw new HttpError(409, "ALREADY_MEMBER");
  }

  if (input.resourceId) {
    const [r] = await db
      .select({ id: resources.id, type: resources.type, memberId: resources.memberId })
      .from(resources)
      .where(and(eq(resources.id, input.resourceId), eq(resources.businessId, businessId)))
      .limit(1);
    if (!r) throw new HttpError(404, "NOT_FOUND"); // 타 사업장 자원은 존재를 노출하지 않는다
    if (r.type !== "STAFF" || r.memberId) throw new HttpError(409, "RESOURCE_NOT_LINKABLE");
  }

  const { memberId, userId } = await db.transaction(async (tx) => {
    let userId = existingUser?.id;
    if (!userId) {
      const [u] = await tx.insert(users).values({ email: input.email, name: input.name, phone: input.phone ?? null, provider: "LOCAL" }).returning({ id: users.id });
      userId = u.id;
    }
    const [m] = await tx
      .insert(businessMembers)
      .values({ userId, businessId, role: "MANAGER", status: "INVITED", permissions: input.permissions })
      .returning({ id: businessMembers.id });
    // 자원 연결 (FR-AUTH-020 "기존 담당자 연결"): 지정된 resourceId → 아니면 같은 이름의 계정 없는 STAFF 자원 자동 연결 → 아니면 새로 생성
    let linked = 0;
    if (input.resourceId) {
      linked = (await tx.update(resources).set({ memberId: m.id }).where(and(eq(resources.id, input.resourceId), isNull(resources.memberId))).returning({ id: resources.id })).length;
      if (linked !== 1) throw new HttpError(409, "RESOURCE_NOT_LINKABLE");
    } else {
      linked = (
        await tx
          .update(resources)
          .set({ memberId: m.id })
          .where(
            and(
              eq(resources.id, sql`(select id from ${resources} where ${resources.businessId} = ${businessId} and ${resources.type} = 'STAFF' and ${resources.memberId} is null and lower(${resources.name}) = lower(${input.name}) order by ${resources.createdAt} limit 1)`),
            ),
          )
          .returning({ id: resources.id })
      ).length;
    }
    if (linked === 0) await tx.insert(resources).values({ businessId, type: "STAFF", memberId: m.id, name: input.name, capacity: 1 });
    await writeAudit(
      { action: "MEMBER_CREATE", actorId: inviter.uid, actorRole: "OWNER", businessId, targetType: "BUSINESS_MEMBER", targetId: m.id, diff: { email: hashPii(input.email), permissions: input.permissions }, meta },
      tx,
    );
    return { memberId: m.id, userId };
  });

  await sendInvite({ userId, email: input.email, businessName: biz.name, inviterName: inviter.name }, meta.ip);
  return { memberId };
}

async function sendInvite(t: { userId: string; email: string; businessName: string; inviterName: string }, ip: string | null) {
  const raw = await issueToken("INVITE", t.userId, ip);
  await sendMail(inviteMail(t.email, t.businessName, t.inviterName, absoluteUrl(`/invite/${raw}`), INVITE_TTL_HOURS));
}

/** 재발송 — INVITED 상태만. 이전 링크는 새 발급으로 무효화된다 */
export async function resendInvite(businessId: string, memberId: string, inviter: { uid: string; name: string }, meta: RequestMeta) {
  const [row] = await db
    .select({ userId: users.id, email: users.email, status: businessMembers.status, businessName: businesses.name })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, businessId)))
    .limit(1);
  if (!row) throw new HttpError(404, "NOT_FOUND");
  if (row.status !== "INVITED") throw new HttpError(409, "NOT_INVITED");
  await sendInvite({ userId: row.userId, email: row.email, businessName: row.businessName, inviterName: inviter.name }, meta.ip);
}

export type InvitePreview =
  | { ok: true; businessName: string; name: string; emailMasked: string; needsPassword: boolean }
  | { ok: false; reason: "INVALID" | "EXPIRED" | "USED" | "NOT_INVITED" };

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

async function inviteContext(userId: string) {
  const [row] = await db
    .select({ memberId: businessMembers.id, status: businessMembers.status, businessName: businesses.name, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(eq(businessMembers.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function previewInvite(raw: string): Promise<InvitePreview> {
  const t = await peekToken("INVITE", raw);
  if (!t.ok) return { ok: false, reason: t.reason };
  const ctx = await inviteContext(t.userId);
  if (!ctx || ctx.status !== "INVITED") return { ok: false, reason: "NOT_INVITED" };
  return { ok: true, businessName: ctx.businessName, name: ctx.name, emailMasked: maskEmail(ctx.email), needsPassword: ctx.passwordHash === null };
}

export type AcceptResult = { ok: true; email: string } | { ok: false; reason: "INVALID" | "EXPIRED" | "USED" | "NOT_INVITED" | "PASSWORD_REQUIRED" };

/** 수락: (필요하면) 비밀번호 확인 → 토큰 소비 → 비밀번호 설정 → INVITED → ACTIVE. 메일 링크를 열었으니 이메일은 검증된 것으로 본다 */
export async function acceptInvite(raw: string, password: string | undefined): Promise<AcceptResult> {
  const pre = await peekToken("INVITE", raw);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const pre_ctx = await inviteContext(pre.userId);
  if (!pre_ctx || pre_ctx.status !== "INVITED") return { ok: false, reason: "NOT_INVITED" };
  if (pre_ctx.passwordHash === null && !password) return { ok: false, reason: "PASSWORD_REQUIRED" };

  const passwordHash = password ? await hashPassword(password) : null;
  // 트랜잭션 안의 실패는 **던져서** 롤백시킨다 — 드리즐에서 콜백의 return 은 항상 COMMIT 이다.
  class Abort extends Error {
    constructor(public reason: "INVALID" | "EXPIRED" | "USED" | "NOT_INVITED") {
      super(reason);
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const t = await consumeToken("INVITE", raw, tx);
      if (!t.ok) throw new Abort(t.reason);
      const patch: Partial<typeof users.$inferInsert> = { emailVerifiedAt: new Date() };
      if (passwordHash) patch.passwordHash = passwordHash;
      await tx.update(users).set(patch).where(eq(users.id, t.userId));
      const rows = await tx
        .update(businessMembers)
        .set({ status: "ACTIVE" })
        .where(and(eq(businessMembers.id, pre_ctx.memberId), eq(businessMembers.status, "INVITED")))
        .returning({ id: businessMembers.id });
      if (rows.length !== 1) throw new Abort("NOT_INVITED");
      return { ok: true as const, email: pre_ctx.email };
    });
  } catch (e) {
    if (e instanceof Abort) return { ok: false, reason: e.reason };
    throw e;
  }
}

export type MemberListItem = {
  id: string;
  name: string;
  emailMasked: string;
  role: "OWNER" | "MANAGER";
  status: "INVITED" | "ACTIVE" | "INACTIVE";
  permissions: MemberPermissions;
  createdAt: Date;
};

export async function listMembers(businessId: string): Promise<MemberListItem[]> {
  const rows = await db
    .select({ id: businessMembers.id, name: users.name, email: users.email, role: businessMembers.role, status: businessMembers.status, permissions: businessMembers.permissions, createdAt: businessMembers.createdAt })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(eq(businessMembers.businessId, businessId))
    .orderBy(businessMembers.createdAt);
  // 이메일 원문은 응답·RSC props 에 싣지 않는다 — 마스킹만 (매니저도 이 목록을 본다)
  return rows.map(({ email, ...r }) => ({ ...r, emailMasked: maskEmail(email), permissions: r.permissions ?? {} }));
}
