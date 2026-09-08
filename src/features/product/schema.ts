import { z } from "zod";
import { timeSchema, toMin } from "@/features/business/hours";

/**
 * 예약 상품 입력 (FR-PRD-010, #32). 업종별 모델 없이 세 스위치의 조합:
 *   시작 시각  startMode FREE(slotIntervalMin) | FIXED(fixedStartTimes)
 *   이용 시간  durationMin 고정 | durationOptions 고객 선택 (FREE 에서만)
 *   정원       capacityPerSlot · maxPartySize
 * 여기는 입력 자체의 모양만 본다. 자원·영업시간에 기대는 검증(정원 ≤ 자원 정원, 소요시간 ≤ 영업시간, 회차가 영업시간 밖)은 products.ts 가 DB 를 보고 한다.
 */
export const SLOT_INTERVALS = [10, 15, 20, 30, 60] as const;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export const MAX_IMAGES = 5;
export const MAX_FIXED_TIMES_PER_DAY = 12;
export const MAX_DURATION_OPTIONS = 6;

const minutes5 = (label: string) => z.number().int(`${label}은 5분 단위입니다`).min(5, `${label}은 5분 이상`).max(480, `${label}은 480분(8시간) 이하`).refine((n) => n % 5 === 0, `${label}은 5분 단위입니다`);

export const fixedStartTimeSchema = z.object({
  dow: z.number().int().min(0).max(6),
  times: z.array(timeSchema).min(1, "회차를 하나 이상 넣어 주세요").max(MAX_FIXED_TIMES_PER_DAY, `요일당 회차는 최대 ${MAX_FIXED_TIMES_PER_DAY}개`),
});

export const productInputSchema = z
  .object({
    name: z.string().trim().min(1, "상품명을 입력해 주세요").max(40, "상품명은 40자 이내"),
    description: z.string().trim().max(1000, "설명은 1000자 이내").optional().nullable(),
    images: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(MAX_IMAGES, `사진은 최대 ${MAX_IMAGES}장`).default([]),
    startMode: z.enum(["FREE", "FIXED"]),
    slotIntervalMin: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).optional().nullable(),
    fixedStartTimes: z.array(fixedStartTimeSchema).max(7).optional().nullable(),
    durationMin: minutes5("소요 시간"),
    durationOptions: z.array(minutes5("이용 시간 옵션")).max(MAX_DURATION_OPTIONS, `이용 시간 옵션은 최대 ${MAX_DURATION_OPTIONS}개`).optional().nullable(),
    bufferBeforeMin: z.number().int().min(0).max(60, "버퍼는 60분 이하").default(0),
    bufferAfterMin: z.number().int().min(0).max(60, "버퍼는 60분 이하").default(0),
    capacityPerSlot: z.number().int().min(1, "슬롯당 정원은 1 이상").max(500),
    maxPartySize: z.number().int().min(1, "1건 최대 인원은 1 이상").max(500),
    priceDisplay: z.string().trim().max(50, "가격 표기는 50자 이내").optional().nullable(),
    resourceIds: z.array(z.uuid()).min(1, "담당 자원을 하나 이상 골라 주세요").max(50),
    resourceSelectMode: z.enum(["REQUIRED", "OPTIONAL", "AUTO", "NONE"]),
    status: z.enum(["DRAFT", "ACTIVE", "HIDDEN"]).default("DRAFT"),
    /** 예약 형태가 바뀌는 수정에서, 영향받는 미래 예약이 있어도 진행하겠다는 확인 (FR-PRD-020) */
    confirmAffected: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.startMode === "FREE") {
      if (!p.slotIntervalMin) ctx.addIssue({ code: "custom", path: ["slotIntervalMin"], message: "자유 시작은 슬롯 간격이 필요합니다" });
      if (p.durationOptions && p.durationOptions.length > 0) {
        if (!p.durationOptions.includes(p.durationMin)) ctx.addIssue({ code: "custom", path: ["durationMin"], message: "기본 소요 시간은 이용 시간 옵션 중 하나여야 합니다" });
        if (new Set(p.durationOptions).size !== p.durationOptions.length) ctx.addIssue({ code: "custom", path: ["durationOptions"], message: "이용 시간 옵션이 중복됩니다" });
      }
    } else {
      if (p.durationOptions && p.durationOptions.length > 0) ctx.addIssue({ code: "custom", path: ["durationOptions"], message: "고정 회차 상품은 이용 시간 옵션을 둘 수 없습니다 — 회차 길이는 상품이 정합니다" });
      const days = p.fixedStartTimes ?? [];
      if (days.length === 0) ctx.addIssue({ code: "custom", path: ["fixedStartTimes"], message: "고정 회차 시각을 하나 이상 넣어 주세요" });
      if (new Set(days.map((d) => d.dow)).size !== days.length) ctx.addIssue({ code: "custom", path: ["fixedStartTimes"], message: "같은 요일이 두 번 들어 있습니다" });
      // 회차 간격 < 소요 시간 + 버퍼 → 회차가 겹친다 → 거부
      const need = p.durationMin + p.bufferBeforeMin + p.bufferAfterMin;
      days.forEach((d, i) => {
        const sorted = d.times.map(toMin).sort((a, b) => a - b);
        if (new Set(sorted).size !== sorted.length) ctx.addIssue({ code: "custom", path: ["fixedStartTimes", i], message: `${DOW[d.dow]}요일에 같은 회차 시각이 두 번 들어 있습니다` });
        for (let k = 1; k < sorted.length; k++) {
          if (sorted[k] - sorted[k - 1] < need) {
            ctx.addIssue({ code: "custom", path: ["fixedStartTimes", i], message: `${DOW[d.dow]}요일 회차 간격이 소요 시간+버퍼(${need}분)보다 짧아 겹칩니다` });
            break;
          }
        }
      });
    }
    if (p.maxPartySize > p.capacityPerSlot) ctx.addIssue({ code: "custom", path: ["maxPartySize"], message: "1건 최대 인원은 슬롯당 정원을 넘을 수 없습니다" });
  });

export type ProductInput = z.output<typeof productInputSchema>;

/** 매니저(editProduct)가 담당 상품에서 바꿀 수 있는 것 — 설명·사진·노출 상태만 (FR-PRD-020) */
export const productLimitedInputSchema = z.object({
  description: z.string().trim().max(1000, "설명은 1000자 이내").optional().nullable(),
  images: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(MAX_IMAGES).optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
});
export type ProductLimitedInput = z.infer<typeof productLimitedInputSchema>;

/** 회차 시각을 정렬·정규화 — 저장 형태를 한 가지로 */
export function normalizeFixedStartTimes(days: Array<{ dow: number; times: string[] }>): Array<{ dow: number; times: string[] }> {
  return days
    .map((d) => ({ dow: d.dow, times: [...new Set(d.times)].sort((a, b) => toMin(a) - toMin(b)) }))
    .sort((a, b) => a.dow - b.dow);
}
