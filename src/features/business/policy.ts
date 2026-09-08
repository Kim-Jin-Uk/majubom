import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { businesses, type BusinessPolicy } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/request-meta";
import { DEFAULT_POLICY } from "./policy-defaults";

/**
 * 예약 정책 (FR-BIZ-020, #27). 정책 변경은 **미래 예약에만** 적용된다 — 이미 생성된 예약은 생성 시점 스냅샷(cancelDeadlineHours)을 따른다.
 * 범위는 명세에 없어 여기서 정했다: 운영상 말이 되는 상한(한 달 선행·1년 예약·7일 취소 마감 등).
 */
const range = (min: number, max: number, unit: string) => z.number().int(`${unit} 단위 정수여야 합니다`).min(min, `${min}${unit} 이상`).max(max, `${max}${unit} 이하`);

export const policySchema = z.object({
  autoConfirm: z.boolean(),
  minLeadTimeMin: range(0, 30 * 24 * 60, "분"),
  maxAdvanceDays: range(1, 365, "일"),
  cancelDeadlineHours: range(0, 24 * 7, "시간"),
  maxActivePerCustomer: range(1, 20, "건"),
  autoNoShowAfterHours: range(1, 72, "시간"),
  requestExpireHours: range(1, 72, "시간"),
  reviewEnabled: z.boolean(),
  shiftAutoApprove: z.boolean(),
});

/** 위저드 5단계 완료 판정 — 기본값에서 하나라도 바꿨으면 "정책을 검토했다"고 본다 (별도 상태를 저장하지 않는다) */
export function isPolicyTouched(p: BusinessPolicy): boolean {
  return (Object.keys(DEFAULT_POLICY) as (keyof BusinessPolicy)[]).some((k) => p[k] !== DEFAULT_POLICY[k]);
}

export async function getPolicy(businessId: string): Promise<BusinessPolicy> {
  const [b] = await db.select({ policy: businesses.policy }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new HttpError(404, "NOT_FOUND");
  return { ...DEFAULT_POLICY, ...b.policy };
}

/** 변경된 키만 감사 로그 diff 에 남긴다 (FR-ADM-040 "diff 는 변경 필드만") */
export async function updatePolicy(businessId: string, input: BusinessPolicy, actor: { uid: string; role: "OWNER" | "MANAGER" }, meta: RequestMeta): Promise<BusinessPolicy> {
  const before = await getPolicy(businessId);
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(input) as (keyof BusinessPolicy)[]) {
    if (before[k] !== input[k]) diff[k] = { from: before[k], to: input[k] };
  }
  if (Object.keys(diff).length === 0) return before;
  await db.transaction(async (tx) => {
    await tx.update(businesses).set({ policy: input }).where(eq(businesses.id, businessId));
    await writeAudit({ action: "POLICY_UPDATE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "BUSINESS", targetId: businessId, diff, meta }, tx);
  });
  return input;
}
