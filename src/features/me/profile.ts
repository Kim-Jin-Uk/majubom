import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { notificationPreferences, users } from "@/db/schema";
import { nameSchema, phoneSchema } from "@/features/auth/validation";
import { defaultsFor, EVENT_GROUPS, isInAppLocked, type PreferenceInput, type PreferenceRow } from "./notification-rules";

/**
 * 마이페이지의 읽기·쓰기 (FR-NOTI-030, #90). 규칙은 `notification-rules.ts` 에 있다 —
 * 화면이 같은 규칙을 써야 하는데 여기 두면 `pg` 가 브라우저 번들로 딸려 들어간다.
 *
 * **이메일은 여기서 바꾸지 않는다.** 로그인 아이디이자 알림 폴백 채널이라 바꾸려면 새 주소 검증과
 * 세션 처리가 따라붙는다 — 인증 쪽 일이다. 화면은 읽기 전용으로 보여 준다.
 */
export const profileInputSchema = z.object({
  name: nameSchema,
  /** 빈 문자열은 "지움" 이다 — 연락처는 필수가 아니다 */
  phone: z.union([phoneSchema, z.literal("")]).optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export async function updateProfile(userId: string, input: ProfileInput): Promise<void> {
  await db.update(users).set({ name: input.name, phone: input.phone?.trim() ? input.phone : null }).where(eq(users.id, userId));
}

export async function loadProfile(userId: string): Promise<{ name: string; email: string; phone: string | null } | null> {
  const [u] = await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
  return u ?? null;
}

/**
 * **행이 없으면 기본값**이다 — 가입할 때 네 행을 미리 만들지 않는다.
 * 만들어 두면 그룹을 하나 늘리는 날 기존 사용자 전원에게 백필 마이그레이션이 필요해진다.
 */
export async function loadPreferences(userId: string): Promise<PreferenceRow[]> {
  const rows = await db
    .select({ eventGroup: notificationPreferences.eventGroup, inApp: notificationPreferences.inApp, push: notificationPreferences.push, email: notificationPreferences.email })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const saved = new Map(rows.map((r) => [r.eventGroup, r]));
  return EVENT_GROUPS.map((g) => saved.get(g) ?? { eventGroup: g, ...defaultsFor(g) });
}

/** 인앱이 잠긴 그룹은 **보낸 값과 무관하게** true 로 적는다 — 규칙은 서버가 지킨다 */
export async function savePreference(userId: string, input: PreferenceInput): Promise<void> {
  const value = { inApp: isInAppLocked(input.eventGroup) ? true : input.inApp, push: input.push, email: input.email };
  await db
    .insert(notificationPreferences)
    .values({ userId, eventGroup: input.eventGroup, ...value })
    .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.eventGroup], set: value });
}
