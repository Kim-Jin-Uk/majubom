"use client";

import { Alert } from "@/components/ui";

/**
 * 시간을 줄여서 밖으로 밀려나는 예약을 **무엇인지 보여 준다**.
 *
 * "예약이 있어 바꿀 수 없습니다" 만 띄우면 사장님은 어느 예약을 정리해야 하는지 알 수 없어
 * 예약 목록을 처음부터 훑게 된다. 예약번호·손님·시각을 그대로 적어 둔다 — 그게 취소·이동에 필요한 값이다.
 */
export type ConflictItem = { id: string; code: string; startAt: string | Date; endAt: string | Date; resourceName: string; customerName: string | null };

const SHOWN = 5;

function when(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function HoursConflictNotice({ items, what }: { items: ConflictItem[]; what: string }) {
  if (items.length === 0) return null;
  return (
    <Alert kind="error">
      <b>
        {what}을 줄이면 이미 잡힌 예약 {items.length}건이 그 시간 밖으로 나갑니다.
      </b>{" "}
      먼저 이 예약을 취소하거나 다른 시각으로 옮긴 뒤 다시 저장해 주세요.
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {items.slice(0, SHOWN).map((r) => (
          <li key={r.id}>
            {when(r.startAt)} · {r.resourceName} · {r.customerName ?? "손님"} <span className="muted">({r.code})</span>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && <p style={{ margin: "6px 0 0" }}>외 {items.length - SHOWN}건</p>}
    </Alert>
  );
}
