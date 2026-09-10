import { calendarDay, dayText, rangeText } from "./widget/format";

/**
 * 메일에 쓸 예약 시각 문구. **화면과 같은 규칙을 쓴다** — 위젯·콘솔이 쓰는 `format.ts` 를 그대로 부른다.
 * 여기서 따로 포맷하면 자정 넘김(`익일`)이나 요일 계산이 화면과 어긋나는 날이 온다.
 *
 * 해를 붙이는 이유는 메일만의 사정이다: 화면은 지금 보고 있는 달 안에서 읽지만,
 * 메일은 몇 달 뒤 받은편지함에서 다시 열린다.
 */
export function whenText(startAt: Date, endAt: Date, tz: string): string {
  const start = startAt.toISOString();
  const end = endAt.toISOString();
  const day = calendarDay(start, tz);
  return `${day.slice(0, 4)}년 ${dayText(day)} ${rangeText(start, end, tz)}`;
}
