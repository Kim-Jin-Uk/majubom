import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { absoluteUrl } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { sendMail } from "@/lib/mail";
import { passwordResetMail, passwordResetSocialOnlyMail } from "@/lib/mail/templates";
import type { RequestMeta } from "@/lib/request-meta";
import { PASSWORD_RESET_TTL_MIN } from "./constants";
import { hashPassword } from "./crypto";
import { revokeAllSessions } from "./session-store";
import { consumeToken, issueToken, peekToken } from "./tokens";

/**
 * 비밀번호 재설정 (FR-AUTH-040).
 * - 요청: 계정 존재 여부를 응답으로 구분하지 않는다 — 있으면 메일, 없으면 아무 일도 없이 같은 응답.
 * - 소셜 전용(passwordHash=null) 계정은 "카카오/구글로 로그인해 주세요" 메일.
 * - 성공: 리프레시 토큰 전부 폐기 + PASSWORD_CHANGE 감사 로그.
 */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const [u] = await db.select({ id: users.id, passwordHash: users.passwordHash, provider: users.provider, status: users.status }).from(users).where(eq(users.email, email)).limit(1);
  if (!u || u.status !== "ACTIVE" || email.endsWith("@internal")) return;
  if (u.passwordHash === null && u.provider !== "LOCAL") {
    await sendMail(passwordResetSocialOnlyMail(email, u.provider, absoluteUrl("/login")));
    return;
  }
  // LOCAL 인데 비밀번호가 없는 계정(초대 미수락 매니저)도 재설정 링크로 비밀번호를 만들 수 있게 둔다
  const raw = await issueToken("PASSWORD_RESET", u.id, meta.ip);
  await sendMail(passwordResetMail(email, absoluteUrl(`/reset-password/${raw}`), PASSWORD_RESET_TTL_MIN));
}

export type ResetPreview = { ok: true } | { ok: false; reason: "INVALID" | "EXPIRED" | "USED" };

export async function previewPasswordReset(raw: string): Promise<ResetPreview> {
  const t = await peekToken("PASSWORD_RESET", raw);
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

export type ResetResult = { ok: true } | { ok: false; reason: "INVALID" | "EXPIRED" | "USED" };

export async function confirmPasswordReset(raw: string, password: string, meta: RequestMeta): Promise<ResetResult> {
  const passwordHash = await hashPassword(password);
  const r = await db.transaction(async (tx) => {
    const t = await consumeToken("PASSWORD_RESET", raw, tx);
    if (!t.ok) return t;
    await tx.update(users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
    return t;
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  await revokeAllSessions(r.userId);
  await writeAudit({ action: "PASSWORD_CHANGE", actorId: r.userId, actorRole: "CUSTOMER", targetType: "USER", targetId: r.userId, diff: { via: "RESET_LINK" }, meta });
  return { ok: true };
}
