import type { ReservationStatus } from "../slot-types";

/**
 * 예약 상태·시각의 표시 규칙. 순수 함수 — 서버 컴포넌트와 클라이언트 패널이 같이 쓴다.
 *
 * 시각 문자열은 **사업장 타임존의 벽시계**(`2026-10-01T10:00:00+09:00`)로 이미 서버에서 만들어져 온다.
 * `new Date()` 로 되돌려 포맷하면 보는 사람의 시계로 옮겨져 매장 시각과 어긋난다 — 그래서 문자열을 그대로 자른다.
 */

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  REQUESTED: "승인 대기",
  CONFIRMED: "확정",
  COMPLETED: "완료",
  CANCELED_BY_USER: "고객 취소",
  CANCELED_BY_BIZ: "매장 취소",
  NO_SHOW: "노쇼",
  REJECTED: "거절",
  EXPIRED: "만료",
};

/** [배경, 글자] — globals.css 의 토큰 */
export const STATUS_COLOR: Record<ReservationStatus, [string, string]> = {
  REQUESTED: ["var(--warn-bg)", "var(--warn)"],
  CONFIRMED: ["var(--primary-tint)", "var(--primary-dark)"],
  COMPLETED: ["var(--muted-fill)", "var(--text-2)"],
  CANCELED_BY_USER: ["var(--muted-fill)", "var(--text-3)"],
  CANCELED_BY_BIZ: ["var(--muted-fill)", "var(--text-3)"],
  NO_SHOW: ["var(--bad-bg)", "var(--bad)"],
  REJECTED: ["var(--muted-fill)", "var(--text-3)"],
  EXPIRED: ["var(--muted-fill)", "var(--text-3)"],
};

export const VIA_LABEL = { WEB: "웹", CHAT: "채팅", WALK_IN: "워크인" } as const;

export const dayOf = (iso: string): string => iso.slice(0, 10);
export const hhmm = (iso: string): string => iso.slice(11, 16);

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** `2026-10-01` → `10월 1일 (목)` */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** `10:00 – 11:30`. 자정을 넘기면 날짜를 붙인다 */
export function rangeLabel(startAt: string, endAt: string): string {
  return dayOf(startAt) === dayOf(endAt) ? `${hhmm(startAt)} – ${hhmm(endAt)}` : `${hhmm(startAt)} – 익일 ${hhmm(endAt)}`;
}

/** `2026-10-01T10:00:00+09:00` → `2026-10-01 10:00` (이력·감사 표시) */
export const stampLabel = (iso: string): string => `${dayOf(iso)} ${hhmm(iso)}`;
