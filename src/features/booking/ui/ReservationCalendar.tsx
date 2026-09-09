import Link from "next/link";
import type { CalendarData } from "../calendar";
import { dayLabel, hhmm, STATUS_COLOR, STATUS_LABEL } from "./status";

/**
 * 일/주 캘린더 (FR-BOOK-080, #60). 서버 컴포넌트 — 상태가 없다. 뷰 전환·이동은 링크(searchParams)다.
 *
 * 컬럼은 **일 뷰에서 자원, 주 뷰에서 날짜**다. 명세는 둘 다 자원별 컬럼이라고 하는데
 * 자원이 여럿인 주 뷰는 7 × N 컬럼이 되어 폰에서는 물론 데스크톱에서도 못 읽는다 — LATER.md L-34.
 * 주 뷰의 블록에는 자원명을 붙여 어느 자리인지 잃지 않게 한다.
 *
 * 격자 높이는 `gridStartMin ~ gridEndMin` 을 100% 로 잡고 블록을 % 로 얹는다.
 * 자정을 넘긴 예약은 `endMin > 1440` 이라 그대로 아래로 이어진다 — 잘라내면 새벽 손님이 사라진다.
 */
/** 영업일 기준 분 → 벽시계 문자열 (1440 을 넘으면 익일) */
const fmtMinShort = (m: number) => `0000-00-00T${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function ReservationCalendar({ data, span, resourceNames }: { data: CalendarData; span: "day" | "week"; resourceNames: Map<string, string> }) {
  const total = data.gridEndMin - data.gridStartMin;
  const hours: number[] = [];
  // 마지막 눈금(gridEndMin)은 넣지 않는다 — 가운데 정렬이라 절반이 격자 밖으로 잘린다
  for (let m = data.gridStartMin; m < data.gridEndMin; m += 60) hours.push(m);

  // 일 뷰: 자원이 컬럼 · 주 뷰: 날짜가 컬럼(모든 자원을 한 컬럼에 겹쳐 놓지 않고 나란히)
  const columns =
    span === "day"
      ? data.columns.map((c) => ({ key: c.resourceId, label: c.name, days: [c.days[0]].filter(Boolean), withResource: false }))
      : data.dates.map((date) => ({
          key: date,
          label: dayLabel(date),
          days: data.columns.map((c) => c.days.find((d) => d.date === date)).filter((d): d is NonNullable<typeof d> => Boolean(d)),
          withResource: true,
          resourceIds: data.columns.map((c) => c.resourceId),
        }));

  if (columns.length === 0) return <p className="sub">표시할 담당자·공간이 없어요.</p>;

  return (
    <div className="cal-wrap">
      <div className="cal" style={{ gridTemplateColumns: `52px repeat(${columns.length}, minmax(110px, 1fr))` }}>
        <div className="cal-corner" />
        {columns.map((c) => (
          <div key={c.key} className="cal-head">
            {c.label}
          </div>
        ))}

        <div className="cal-gutter" style={{ height: (total / 60) * 48 }}>
          {hours.map((m) => (
            <div key={m} className="cal-hour" style={{ top: ((m - data.gridStartMin) / total) * 100 + "%" }}>
              {String(Math.floor(m / 60) % 24).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {columns.map((c) => (
          <div key={c.key} className="cal-col" style={{ height: (total / 60) * 48 }}>
            {/* 운영시간을 밝게 칠한다. **눈금선보다 먼저** 그려야 선을 덮지 않는다 */}
            {c.days.flatMap((d, di) =>
              d.open.map((w, wi) => (
                <div
                  key={`${di}-${wi}`}
                  className="cal-open"
                  style={{ top: ((w.start - data.gridStartMin) / total) * 100 + "%", height: ((w.end - w.start) / total) * 100 + "%", left: c.withResource ? `${(di / c.days.length) * 100}%` : 0, width: c.withResource ? `${100 / c.days.length}%` : "100%" }}
                />
              )),
            )}
            {hours.slice(1).map((m) => (
              <div key={m} className="cal-line" style={{ top: ((m - data.gridStartMin) / total) * 100 + "%" }} />
            ))}
            {c.days.flatMap((d, di) =>
              d.blocks.map((b) => {
                const [bg, fg] = STATUS_COLOR[b.status];
                const top = ((b.startMin - data.gridStartMin) / total) * 100;
                const height = Math.max(2.2, ((b.endMin - b.startMin) / total) * 100);
                const rid = "resourceIds" in c && Array.isArray(c.resourceIds) ? c.resourceIds[di] : undefined;
                return (
                  <Link
                    key={b.id}
                    href={`/console/reservations/${b.id}`}
                    className={b.mine ? "cal-block mine" : "cal-block"}
                    style={{ top: `${top}%`, height: `${height}%`, background: bg, color: fg, left: c.withResource ? `${(di / c.days.length) * 100 + 1}%` : "2px", width: c.withResource ? `${100 / c.days.length - 2}%` : "calc(100% - 4px)" }}
                    title={`${b.customerName} · ${b.productName} · ${STATUS_LABEL[b.status]}${rid ? ` · ${resourceNames.get(rid) ?? ""}` : ""}`}
                  >
                    <span className="sr-only">
                      {hhmm(fmtMinShort(b.startMin))} – {hhmm(fmtMinShort(b.endMin))} · {STATUS_LABEL[b.status]}
                      {rid ? ` · ${resourceNames.get(rid) ?? ""}` : ""} ·{" "}
                    </span>
                    <b>{b.customerName || "이름 없음"}</b>
                    <span aria-hidden="true">{b.productName}</span>
                    {c.withResource && rid && <span className="who">{resourceNames.get(rid)}</span>}
                  </Link>
                );
              }),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
