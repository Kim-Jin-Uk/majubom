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
  return mergePolicy(b.policy);
}

/** jsonb 에 남은 옛 키·빈 값은 버리고 알려진 9개 키만, 타입이 맞을 때만 취한다 (기본값과 병합) */
export function mergePolicy(stored: Partial<Record<string, unknown>> | null | undefined): BusinessPolicy {
  const out = { ...DEFAULT_POLICY } as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_POLICY) as (keyof BusinessPolicy)[]) {
    const v = stored?.[k];
    if (typeof v === typeof DEFAULT_POLICY[k] && v !== null) out[k] = v;
  }
  return out as BusinessPolicy;
}

/** 변경된 키만 감사 로그 diff 에 남긴다 (FR-ADM-040 "diff 는 변경 필드만") */
export async function updatePolicy(businessId: string, input: BusinessPolicy, actor: { uid: string; role: "OWNER" | "MANAGER" }, meta: RequestMeta): Promise<BusinessPolicy> {
  return db.transaction(async (tx) => {
    // diff 의 기준(before)을 같은 트랜잭션에서 잠그고 읽는다 — 동시 저장이 서로의 변경을 감사 로그에서 지우지 않도록
    const [b] = await tx.select({ policy: businesses.policy }).from(businesses).where(eq(businesses.id, businessId)).limit(1).for("update");
    if (!b) throw new HttpError(404, "NOT_FOUND");
    const before = mergePolicy(b.policy);
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(DEFAULT_POLICY) as (keyof BusinessPolicy)[]) {
      if (before[k] !== input[k]) diff[k] = { from: before[k], to: input[k] };
    }
    if (Object.keys(diff).length === 0) return before;
    await tx.update(businesses).set({ policy: input }).where(eq(businesses.id, businessId));
    await writeAudit({ action: "POLICY_UPDATE", actorId: actor.uid, actorRole: actor.role, businessId, targetType: "BUSINESS", targetId: businessId, diff, meta }, tx);
    return input;
  });
}
