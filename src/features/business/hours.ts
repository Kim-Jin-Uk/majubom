import { z } from "zod";

/** "HH:MM" 시각 유틸 — 서버·클라이언트 공용(DB 를 끌어오지 않는다). settings.ts 와 product/schema.ts 가 같이 쓴다 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeSchema = z.string().regex(TIME, "HH:MM 형식이어야 합니다");

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
