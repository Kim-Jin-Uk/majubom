/** 사업장 타임존의 "오늘" (YYYY-MM-DD). 서버 시계는 UTC 라 한국 새벽에는 날짜가 하루 어긋난다 */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
