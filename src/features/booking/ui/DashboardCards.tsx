import Link from "next/link";
import type { DashboardData } from "../dashboard";
import { dayLabel, hhmm, STATUS_COLOR, STATUS_LABEL, VIA_LABEL } from "./status";

/**
 * 콘솔 대시보드 카드 (FR-BOOK-080, #59). 서버 컴포넌트 — 상태가 없다.
 *
 * 명세의 네 카드 중 "미응답 상담" 은 없다. `ChatRoom` 이 Firestore 에 있고 채팅 에픽(M8)이 아직이라
 * 지금 넣으면 늘 0 인 카드가 하나 붙는다 — 채팅을 켤 때 여기에 추가한다.
 *
 * 폰이 기본이다(01 §10 콘솔 모바일): 카드는 세로 스택, 오늘 예약은 표가 아니라 리스트다.
 */
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const seatNote = (u: { byResource: Array<{ capacity: number }> }) => (u.byResource.some((r) => r.capacity > 1) ? " · 정원 반영(좌석 기준)" : "");
const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ""}` : `${min}분`);

export function DashboardCards({ data, role }: { data: DashboardData; role: "OWNER" | "MANAGER" }) {
  const { thisWeek, lastWeekRate } = data;
  // 지난주 대비 증감 (명세). 지난주에 운영시간이 없었으면 비교 자체가 뜻이 없다
  const delta = thisWeek.rate !== null && lastWeekRate !== null ? Math.round((thisWeek.rate - lastWeekRate) * 100) : null;

  return (
    <div className="dash">
      <section className="panel dash-card">
        <h2>오늘 예약</h2>
        <p className="dash-big">
          {data.todayCount}
          <span>건</span>
        </p>
        {data.todayCount === 0 ? (
          <p className="sub">오늘은 잡힌 예약이 없어요.</p>
        ) : (
          <ol className="dash-timeline">
            {data.todayItems.slice(0, 6).map((r) => {
              const [bg, fg] = STATUS_COLOR[r.status];
              return (
                <li key={r.id}>
                  <span className="t">{hhmm(r.startAt)}</span>
                  <Link href={`/console/reservations/${r.id}`}>{r.customerName || "이름 없음"}</Link>
                  <span className="muted">{r.resourceName}</span>
                  {r.createdVia !== "WEB" && <span className="tag tag--soft">{VIA_LABEL[r.createdVia]}</span>}
                  <span className="tag" style={{ background: bg, color: fg, marginLeft: "auto" }}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {data.todayCount > data.todayItems.slice(0, 6).length && (
          <Link href={`/console/reservations?from=${data.today}&to=${data.today}`} className="sub">
            오늘 {data.todayCount}건 전부 보기 →
          </Link>
        )}
      </section>

      <section className="panel dash-card">
        <h2>승인 대기</h2>
        <p className={data.pending > 0 ? "dash-big warn" : "dash-big"}>
          {data.pending}
          <span>건</span>
        </p>
        <p className="sub">{data.pending > 0 ? "고객이 답을 기다리고 있어요. 대기 상태는 자리를 잡아 두기 때문에 오래 두면 팔 수 있는 시간이 막힙니다." : "기다리는 요청이 없어요."}</p>
        {/* 대기 건수는 기간을 안 보지만 목록은 기본이 7일이다 — 링크가 기간을 넉넉히 열지 않으면
            "3건" 을 눌렀는데 빈 목록이 나와서 숫자가 틀린 줄 안다 */}
        {data.pending > 0 && (
          <Link href={`/console/reservations?status=REQUESTED&from=${data.today}&to=${data.pendingTo}`} className="btn btn--primary">
            승인 대기 보기
          </Link>
        )}
      </section>

      <section className="panel dash-card">
        <h2>이번 주 가동률</h2>
        <p className="dash-big">
          {pct(thisWeek.rate)}
          {delta !== null && <span className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}</span>}
        </p>
        <p className="sub">
          운영 {hours(thisWeek.openMin)} 중 {hours(thisWeek.busyMin)} 사용{delta !== null ? ` · 지난주 ${pct(lastWeekRate)}` : " · 지난주 비교 없음"}
          {seatNote(thisWeek)}
        </p>
        {thisWeek.byResource.length > 1 && (
          <ul className="dash-bars">
            {thisWeek.byResource.map((r) => (
              <li key={r.resourceId}>
                <span className="n">{r.name}</span>
                <span className="bar">
                  <i style={{ width: `${Math.round((r.rate ?? 0) * 100)}%` }} />
                </span>
                <span className="v">{pct(r.rate)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.myWeek && (
        <section className="panel dash-card">
          <h2>이번 주 내 근무</h2>
          <p className="sub">{data.myResourceName}</p>
          <ul className="dash-week">
            {data.myWeek.map((d) => (
              <li key={d.date} className={d.date === data.today ? "today" : undefined}>
                <span className="d">{dayLabel(d.date).replace(/^\d+월 /, "")}</span>
                {d.off ? <span className="muted">휴무</span> : <span>{d.work.map((w) => `${w.start}–${w.end}`).join(", ")}</span>}
              </li>
            ))}
          </ul>
          <Link href="/console/schedule" className="sub">
            근무표에서 보기 →
          </Link>
        </section>
      )}

      {role === "MANAGER" && !data.myWeek && <section className="panel dash-card">
        <h2>내 근무</h2>
        <p className="sub">아직 담당 자원이 연결되지 않았어요. 사장님이 담당자·공간에서 계정을 연결하면 근무와 담당 예약이 보입니다.</p>
      </section>}
    </div>
  );
}
