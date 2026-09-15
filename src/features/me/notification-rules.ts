import { z } from "zod";
import { eventGroupEnum } from "@/db/schema/enums";

/**
 * 알림 채널의 규칙 (FR-NOTI-030, #90). **순수 모듈이다** — DB 를 모른다.
 *
 * 나눠 둔 이유는 화면이 이 규칙을 그대로 써야 하기 때문이다. 읽기 계층(`profile.ts`)에 같이 두면
 * 클라이언트 컴포넌트가 그걸 import 하는 순간 `pg` 가 브라우저 번들로 딸려 들어간다(실제로 그랬다).
 */
export type EventGroup = (typeof eventGroupEnum.enumValues)[number];
export type Channels = { inApp: boolean; push: boolean; email: boolean };
export type PreferenceRow = { eventGroup: EventGroup } & Channels;

/** 화면에 내는 순서 — 손님에게 가장 가까운 것부터 */
export const EVENT_GROUPS = ["RESERVATION", "SCHEDULE", "CHAT", "MARKETING"] as const satisfies readonly EventGroup[];

/**
 * **거래성 알림(예약·근무)의 인앱은 끌 수 없다.** 예약이 취소됐다는 사실을 알 길이 아예 없어지면 안 된다.
 * 마케팅은 반대로 세 채널 모두 **옵트인**이다 — 기본이 꺼짐이고, 켜는 것은 사용자의 행동이어야 한다.
 */
const TRANSACTIONAL = new Set<EventGroup>(["RESERVATION", "SCHEDULE"]);
export const isInAppLocked = (g: EventGroup): boolean => TRANSACTIONAL.has(g);
export const defaultsFor = (g: EventGroup): Channels =>
  g === "MARKETING" ? { inApp: false, push: false, email: false } : { inApp: true, push: true, email: true };

/** 사업장 구성원이 아니면 근무 알림을 받을 일이 없다 — 끌 수도 없는 줄을 보여 줄 이유도 없다 */
export function visibleGroups(hasMembership: boolean): EventGroup[] {
  return EVENT_GROUPS.filter((g) => g !== "SCHEDULE" || hasMembership);
}

export const preferenceInputSchema = z.object({
  eventGroup: z.enum(eventGroupEnum.enumValues),
  inApp: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
});
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;
