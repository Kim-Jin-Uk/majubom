import { z } from "zod";

/** "HH:MM" 시각 유틸 — 서버·클라이언트 공용(DB 를 끌어오지 않는다). settings.ts 와 product/schema.ts 가 같이 쓴다 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeSchema = z.string().regex(TIME, "HH:MM 형식이어야 합니다");

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 요일별 영업시간 — 사업장과 **상품**이 같은 형식을 쓴다. `settings.ts` 가 db 를 끌어와
 * 화면에서 import 할 수 없으므로 스키마는 여기 둔다 (slug 규칙을 `slug-rules.ts` 로 뺀 것과 같은 이유).
 */
export const openingHourSchema = z
  .object({
    dow: z.number().int().min(0).max(6),
    open: timeSchema,
    close: timeSchema,
    breaks: z.array(z.object({ start: timeSchema, end: timeSchema })).max(2, "휴게시간은 최대 2구간입니다").optional(),
  })
  .superRefine((h, ctx) => {
    const open = toMin(h.open);
    let close = toMin(h.close);
    if (close <= open) close += 24 * 60; // 익일 마감
    if (close - open > 24 * 60) ctx.addIssue({ code: "custom", path: ["close"], message: "영업시간은 24시간을 넘을 수 없습니다" });
    const spans = (h.breaks ?? []).map((b) => {
      let s = toMin(b.start);
      let e = toMin(b.end);
      if (s < open) s += 24 * 60; // 자정 넘긴 브레이크 (예: 01:00~02:00, 영업 20:00~04:00)
      if (e <= s) e += 24 * 60;
      return { s, e };
    });
    spans.forEach((b, i) => {
      if (b.s < open || b.e > close) ctx.addIssue({ code: "custom", path: ["breaks", i], message: "휴게시간은 영업시간 안에 있어야 합니다" });
    });
    if (spans.length === 2 && spans[0].s < spans[1].e && spans[1].s < spans[0].e) {
      ctx.addIssue({ code: "custom", path: ["breaks"], message: "휴게시간 두 구간이 겹칩니다" });
    }
  });

export const openingHoursSchema = z
  .array(openingHourSchema)
  .max(7)
  .refine((arr) => new Set(arr.map((h) => h.dow)).size === arr.length, "같은 요일이 두 번 들어 있습니다");
