import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, type DbLike } from "@/db/client";
import { businessMembers, businesses, reservations, users } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { revokeAllSessions } from "@/features/auth/session-store";
import { transitionReservation } from "@/features/booking/transitions";
import { writeAudit, type AuditAction } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { businessApprovedMail, businessBlockedMail, businessRejectedMail, businessRestoredMail, businessSuspendedMail } from "@/lib/mail/templates";
import type { RequestMeta } from "@/lib/request-meta";

/**
 * 관리자 콘솔 — 가입 심사(FR-ADM-010, #65) · 사업장 상태 제어(FR-ADM-020, #66).
 *
 * 이 파일의 두 가지 규칙:
 * - **사유 없이 남의 가게를 멈추지 않는다.** 정지·차단·반려는 사유가 필수고, 사업자에게 그대로 전달된다
 * - **끊는 것과 알리는 것을 함께 한다.** 상태만 바꾸고 세션을 남겨 두면 사업자는 콘솔이 왜 안 되는지 모른 채
 *   화면을 새로 고친다. 상태 변경과 세션 폐기는 한 트랜잭션이다
 */
export type AdminActor = { uid: string };

export type ApplicationItem = {
  id: string;
  slug: string;
  name: string;
  bizRegNo: string;
  category: string;
  phone: string | null;
  address: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "BLOCKED";
  ownerName: string;
  ownerEmail: string;
  emailVerifiedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
};

const OWNER = { name: users.name, email: users.email };

/** 사업장 + 대표(OWNER) 한 줄. OWNER 는 사업장당 하나다 (`ALREADY_MEMBER`) */
function withOwner() {
  return db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      bizRegNo: businesses.bizRegNo,
      category: businesses.category,
      phone: businesses.phone,
      address: businesses.address,
      status: businesses.status,
      rejectedReason: businesses.rejectedReason,
      emailVerifiedAt: businesses.emailVerifiedAt,
      createdAt: businesses.createdAt,
      ownerName: OWNER.name,
      ownerEmail: OWNER.email,
    })
    .from(businesses)
    .innerJoin(businessMembers, and(eq(businessMembers.businessId, businesses.id), eq(businessMembers.role, "OWNER")))
    .innerJoin(users, eq(users.id, businessMembers.userId));
}

const toItem = (r: Awaited<ReturnType<ReturnType<typeof withOwner>["where"]>>[number]): ApplicationItem => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  bizRegNo: r.bizRegNo,
  category: r.category,
  phone: r.phone,
  address: r.address,
  status: r.status,
  ownerName: r.ownerName ?? "",
  ownerEmail: r.ownerEmail,
  emailVerifiedAt: r.emailVerifiedAt,
  rejectedReason: r.rejectedReason,
  createdAt: r.createdAt,
});

/**
 * 심사 큐 (FR-ADM-010). **이메일이 검증된 신청만** 큐에 올린다 — 미검증은 7일 뒤 자동 삭제되는 반쪽 신청이라
 * 심사할 대상이 아니다(C1). 기본은 대기 중인 것만, `status` 를 주면 그 상태로 본다.
 */
export async function listApplications(opts: { status?: ApplicationItem["status"]; q?: string } = {}): Promise<ApplicationItem[]> {
  const status = opts.status ?? "PENDING";
  const term = opts.q?.trim();
  const rows = await withOwner()
    .where(
      and(
        eq(businesses.status, status),
        status === "PENDING" ? isNotNull(businesses.emailVerifiedAt) : undefined,
        term ? or(ilike(businesses.name, `%${term}%`), ilike(businesses.bizRegNo, `%${term}%`), ilike(businesses.slug, `%${term}%`)) : undefined,
      ),
    )
    .orderBy(status === "PENDING" ? asc(businesses.createdAt) : desc(businesses.createdAt))
    .limit(200);
  return rows.map(toItem);
}

/** 사업장 목록 (FR-ADM-020). 심사가 끝난 것들 — 상태 제어 화면이 쓴다 */
export async function listBusinesses(opts: { status?: ApplicationItem["status"]; q?: string } = {}): Promise<ApplicationItem[]> {
  const term = opts.q?.trim();
  const rows = await withOwner()
    .where(
      and(
        opts.status ? eq(businesses.status, opts.status) : inArray(businesses.status, ["APPROVED", "SUSPENDED", "BLOCKED"]),
        term ? or(ilike(businesses.name, `%${term}%`), ilike(businesses.bizRegNo, `%${term}%`), ilike(businesses.slug, `%${term}%`)) : undefined,
      ),
    )
    .orderBy(asc(businesses.name))
    .limit(200);
  return rows.map(toItem);
}

export const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    /** 반려 사유 — 사업자에게 그대로 간다 */
    reason: z.string().trim().max(500, "사유는 500자 이내").nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "REJECT" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "반려 사유를 적어 주세요" });
  });
export type DecisionInput = z.output<typeof decisionSchema>;

/**
 * 가입 승인·반려 (FR-ADM-010). 승인은 **공개 URL 을 여는 일**이다 — 콘솔은 신청 직후부터 열려 있다.
 * 반려는 사유가 필수고, 사업자는 같은 이메일로 다시 신청할 수 있다(`business-signup.ts` 재신청 경로).
 */
export async function decideApplication(id: string, input: DecisionInput, actor: AdminActor, meta: RequestMeta): Promise<{ status: ApplicationItem["status"] }> {
  const done = await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: businesses.id, name: businesses.name, slug: businesses.slug, status: businesses.status, emailVerifiedAt: businesses.emailVerifiedAt })
      .from(businesses)
      .where(eq(businesses.id, id))
      .limit(1);
    if (!cur) throw new HttpError(404, "NOT_FOUND");
    if (cur.status !== "PENDING") throw new HttpError(409, "NOT_PENDING", { status: cur.status });
    // 미검증 신청은 심사 대상이 아니다 — 큐에도 없지만 id 를 직접 넣는 경로를 막는다
    if (!cur.emailVerifiedAt) throw new HttpError(409, "EMAIL_UNVERIFIED");

    const status: ApplicationItem["status"] = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const rows = await tx
      .update(businesses)
      .set({ status, approvedAt: status === "APPROVED" ? new Date() : null, rejectedReason: status === "REJECTED" ? (input.reason ?? null) : null })
      .where(and(eq(businesses.id, id), eq(businesses.status, "PENDING")))
      .returning({ id: businesses.id });
    if (rows.length !== 1) throw new HttpError(409, "NOT_PENDING", { status: "CHANGED" });

    await writeAudit(
      { action: status === "APPROVED" ? "BUSINESS_APPROVE" : "BUSINESS_REJECT", actorId: actor.uid, actorRole: "ADMIN", businessId: id, targetType: "BUSINESS", targetId: id, diff: { status: { from: "PENDING", to: status }, reason: input.reason ?? null }, meta },
      tx,
    );
    const owner = await ownerOf(id, tx);
    return { status, name: cur.name, slug: cur.slug, owner };
  });

  // 메일은 커밋 뒤에 — 롤백된 승인 메일이 나가면 사업자는 열리지도 않은 URL 을 안내받는다
  await notify(input.decision === "APPROVE" ? businessApprovedMail(done.owner.email, done.name, publicUrl(done.slug), consoleUrl()) : businessRejectedMail(done.owner.email, done.name, input.reason ?? ""));
  return { status: done.status };
}

export const statusSchema = z
  .object({
    status: z.enum(["APPROVED", "SUSPENDED", "BLOCKED"]),
    reason: z.string().trim().min(1, "사유를 적어 주세요").max(500, "사유는 500자 이내"),
    /** 남은 예약을 함께 취소한다 (BLOCKED 에서만 의미가 있다) */
    cancelReservations: z.boolean().optional(),
    /** 남은 예약을 확인했다 — 취소하지 않고 진행 */
    confirmReservations: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.cancelReservations && v.status !== "BLOCKED") ctx.addIssue({ code: "custom", path: ["cancelReservations"], message: "예약 일괄 취소는 차단할 때만 선택할 수 있습니다" });
  });
export type StatusInput = z.output<typeof statusSchema>;

const AUDIT: Record<StatusInput["status"], AuditAction> = { SUSPENDED: "BUSINESS_SUSPEND", BLOCKED: "BUSINESS_BLOCK", APPROVED: "BUSINESS_RESTORE" };

/**
 * 상태 제어 (FR-ADM-020).
 *
 * - `SUSPENDED` 공개 페이지 비노출 · 신규 예약 차단 · **기존 확정 예약은 유지**. 콘솔은 읽기 전용(프록시가 헤더로 알린다)
 * - `BLOCKED` 위 + 콘솔 접근 전면 차단. 남은 예약이 있으면 한 번 더 확인을 받는다
 * - `APPROVED` 복구
 *
 * 상태를 되돌리는 쪽(`APPROVED`)에서는 세션을 끊지 않는다 — 끊을 이유가 없고, 사업자가 다시 로그인해야 할 뿐이다.
 */
export async function setBusinessStatus(id: string, input: StatusInput, actor: AdminActor, meta: RequestMeta): Promise<{ status: StatusInput["status"]; canceled: number }> {
  const [cur] = await db.select({ id: businesses.id, name: businesses.name, status: businesses.status }).from(businesses).where(eq(businesses.id, id)).limit(1);
  if (!cur) throw new HttpError(404, "NOT_FOUND");
  if (cur.status === "PENDING" || cur.status === "REJECTED") throw new HttpError(409, "NOT_APPROVED", { status: cur.status });
  if (cur.status === input.status) throw new HttpError(409, "SAME_STATUS", { status: cur.status });

  // 차단은 그 가게로 잡힌 예약을 전부 무의미하게 만든다 — 무엇이 남는지 보지 않고 지나가게 두지 않는다
  const live = await liveReservations(id);
  if (input.status === "BLOCKED" && live.length > 0 && !input.cancelReservations && !input.confirmReservations) {
    throw new HttpError(409, "LIVE_RESERVATIONS", { count: live.length, reservations: live.slice(0, 20) });
  }

  // **상태를 먼저 바꾸고 예약을 정리한다.** 순서를 뒤집으면 취소는 됐는데 차단이 실패한 상태가 남고,
  // 그건 손님의 예약만 사라진 가장 나쁜 결과다. 이 순서라면 중간에 멈춰도 "차단됐지만 예약이 남음" 이라
  // 운영자가 다시 눌러 이어 갈 수 있다 (취소 전이는 이미 취소된 건을 409 로 건너뛴다)
  const owner = await db.transaction(async (tx) => {
    const rows = await tx
      .update(businesses)
      .set({ status: input.status })
      .where(and(eq(businesses.id, id), eq(businesses.status, cur.status)))
      .returning({ id: businesses.id });
    if (rows.length !== 1) throw new HttpError(409, "SAME_STATUS", { status: "CHANGED" });

    // 상태만 바꾸고 세션을 남기면 사업자는 콘솔이 왜 안 되는지 모른 채 새로 고친다. 프록시가 매 요청 상태를 보므로
    // 안전에는 이미 문제가 없지만, 끊어 줘야 다시 로그인하며 안내를 본다 (FR-ADM-020 "리프레시 토큰 폐기")
    if (input.status !== "APPROVED") {
      const members = await tx.select({ userId: businessMembers.userId }).from(businessMembers).where(eq(businessMembers.businessId, id));
      for (const m of members) await revokeAllSessions(m.userId, undefined, tx);
    }
    return ownerOf(id, tx);
  });

  let canceled = 0;
  if (input.status === "BLOCKED" && input.cancelReservations) {
    // 운영자 자격으로 취소한다 — 손님에게는 사유가 적힌 취소 메일이 나간다 (`CANCELED_BY_BIZ`)
    for (const r of live) {
      try {
        await transitionReservation(r.id, "CANCELED_BY_BIZ", { kind: "ADMIN", uid: actor.uid }, { reason: input.reason, meta });
        canceled++;
      } catch (e) {
        // 그 사이 손님이 취소했거나 매장이 처리한 건 — 조건부 UPDATE 가 0행을 낸다
        if (e instanceof HttpError && e.status === 409) continue;
        throw e;
      }
    }
  }

  // 감사 로그는 결과가 다 나온 뒤에 한 줄로 남긴다 — 취소 건수가 그 결정의 일부다
  await writeAudit({
    action: AUDIT[input.status],
    actorId: actor.uid,
    actorRole: "ADMIN",
    businessId: id,
    targetType: "BUSINESS",
    targetId: id,
    diff: { status: { from: cur.status, to: input.status }, reason: input.reason, liveReservations: live.length, canceled },
    meta,
  });

  const mail =
    input.status === "SUSPENDED" ? businessSuspendedMail(owner.email, cur.name, input.reason)
    : input.status === "BLOCKED" ? businessBlockedMail(owner.email, cur.name, input.reason, canceled)
    : businessRestoredMail(owner.email, cur.name);
  await notify(mail);
  return { status: input.status, canceled };
}

/** 아직 살아 있는 예약 — 지금 이후로 잡혀 있는 것만. 지난 예약은 차단과 상관이 없다 */
async function liveReservations(businessId: string) {
  return db
    .select({ id: reservations.id, code: reservations.code, startAt: reservations.startAt, status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.businessId, businessId), inArray(reservations.status, ["REQUESTED", "CONFIRMED"]), gte(reservations.startAt, new Date())))
    .orderBy(asc(reservations.startAt));
}

async function ownerOf(businessId: string, q: DbLike = db): Promise<{ userId: string; email: string; name: string }> {
  const [o] = await q
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.role, "OWNER")))
    .limit(1);
  if (!o) throw new HttpError(404, "NOT_FOUND");
  return { userId: o.userId, email: o.email, name: o.name ?? "" };
}

const baseUrl = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const publicUrl = (slug: string) => `${baseUrl()}/@${slug}`;
const consoleUrl = () => `${baseUrl()}/console`;

/** 심사·상태 메일. 발송 실패가 심사 결과를 되돌리지 않는다 — 결과는 이미 커밋됐다 (#57 과 같은 규약) */
async function notify(mail: Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    await sendMail(mail);
  } catch (e) {
    // 주소는 남기지 않는다 (FR-PRIV-010)
    console.error(`[admin] 메일 실패 subject=${mail.subject}: ${(e as Error).message}`);
  }
}

/** 심사 큐 뱃지 — 대기 건수 */
export async function pendingCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(businesses).where(and(eq(businesses.status, "PENDING"), isNotNull(businesses.emailVerifiedAt)));
  return Number(row?.n ?? 0);
}

export const listQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED", "BLOCKED"]).optional(), q: z.string().max(80).optional() });
