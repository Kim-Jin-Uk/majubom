/** 사업장 타임존의 "오늘" (YYYY-MM-DD). 서버 시계는 UTC 라 한국 새벽에는 날짜가 하루 어긋난다 */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

import { z } from "zod";
import { isValidISODate } from "@/features/schedule/resolve";

/** YYYY-MM-DD 이면서 실제로 있는 날짜 */
export const isoDateSchema = z.string().refine(isValidISODate, "YYYY-MM-DD 형식의 실제 날짜여야 합니다");
