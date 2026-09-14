"use client";

import Link from "next/link";
import { useState } from "react";
import type { MyReservation } from "@/features/booking/my-reservations";
import { dayLabel, dayOf, rangeLabel, STATUS_COLOR, STATUS_LABEL } from "@/features/booking/ui/status";

/**
 * 내 예약 목록 (FR-BOOK-090, #88). **탭이다** — 두 목록을 세로로 쌓으면 지난 예약이 50건일 때
 * 다가오는 예약을 보려고 스크롤을 올려야 한다. 손님이 이 화면에 오는 이유의 대부분은 다가오는 쪽이다.
 *
 * 탭 상태를 주소에 두지 않는다. 위젯의 선택과 달리 공유할 일도, 뒤로가기로 돌아올 일도 없다 —
 * 오히려 주소에 두면 "다가오는 예약" 링크를 눌렀는데 지난 탭이 열리는 일이 생긴다.
 */
export function MyReservationList({ upcoming, past }: { upcoming: MyReservation[]; past: MyReservation[] }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const rows = tab === "upcoming" ? upcoming : past;

  return (
    <>
      <div className="myres-tabs" role="tablist" aria-label="예약 목록">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`myres-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="myres-panel"
            className={`myres-tab${tab === t ? " on" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "upcoming" ? "다가오는" : "지난"} 예약 <span className="muted">{t === "upcoming" ? upcoming.length : past.length}</span>
          </button>
        ))}
      </div>

      <div id="myres-panel" role="tabpanel" aria-labelledby={`myres-tab-${tab}`}>
        {rows.length === 0 ? (
          <p className="sub">{tab === "upcoming" ? "다가오는 예약이 없어요." : "지난 예약이 없어요."}</p>
        ) : (
          <ul className="myres-list">
            {rows.map((r) => (
              <li key={r.id}>
                {/* 카드 전체가 상세로 가는 링크다 — 안에 또 링크를 두면 중첩 <a> 가 된다.
                    매장 홈으로 가는 길은 상세에 있다 */}
                <Link href={`/me/reservations/${r.id}`} className="myres">
                  <span className="myres__top">
                    <b className="myres__biz">{r.businessName}</b>
                    <Badge status={r.status} />
                  </span>
                  <span className="myres__when">
                    {dayLabel(dayOf(r.startAt))} {rangeLabel(r.startAt, r.endAt)}
                  </span>
                  <span className="myres__meta muted">
                    {r.productName}
                    {r.staffName ? ` · ${r.staffName}` : ""} · {r.partySize}명
                  </span>
                  <span className="myres__code">
                    예약번호 <b>{r.code}</b>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Badge({ status }: { status: MyReservation["status"] }) {
  const [bg, fg] = STATUS_COLOR[status];
  return (
    <span className="myres__badge" style={{ background: bg, color: fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}
