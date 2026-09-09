import { consoleActor, listReservations } from "@/features/booking/console";
import { getCalendar } from "@/features/booking/calendar";
import { ReservationCalendar } from "@/features/booking/ui/ReservationCalendar";
import { ReservationsPanel } from "@/features/booking/ui/ReservationsPanel";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listProducts } from "@/features/product/products";
import { addDays, dowOf } from "@/features/schedule/resolve";
import Link from "next/link";
import { isoDateSchema, todayIn } from "@/lib/dates";

export const metadata = { title: "예약 — 마주,봄 콘솔" };

/**
 * 예약 목록 · 캘린더 (FR-BOOK-080, #60). 기본 기간은 오늘부터 7일 — ?from 으로 옮길 수 있다(대시보드에서 넘어올 때).
 * 목록의 첫 페이지는 서버가 그리고, 이후 필터·더 보기는 패널이 API 를 친다.
 * 캘린더는 상태가 없어 전부 서버 렌더다 — 뷰·기간 전환이 링크라 뒤로가기가 그대로 동작한다.
 */
export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await consoleViewer("/console/reservations");
  const { settings } = await loadConsoleBusiness(v.membership.businessId);
  const tz = settings.timezone;
  const today = todayIn(tz);
  const sp = await searchParams;
  const asked = isoDateSchema.safeParse(sp.from);
  const from = asked.success ? asked.data : today;
  const askedTo = isoDateSchema.safeParse(sp.to);
  const to = askedTo.success && askedTo.data >= from ? askedTo.data : addDays(from, 7);

  const isCal = sp.view === "calendar";
  const span: "day" | "week" = sp.span === "day" ? "day" : "week";
  // 캘린더는 자기 기간을 따로 잡는다 — 일 뷰는 그 하루, 주 뷰는 그 주의 일요일부터
  const anchor = asked.success ? asked.data : today;
  const calFrom = span === "day" ? anchor : addDays(anchor, -dowOf(anchor));
  const calTo = span === "day" ? calFrom : addDays(calFrom, 6);

  // 대시보드의 "승인 대기 보기" 가 ?status=REQUESTED 로 들어온다 — URL 을 무시하면 그 버튼이 거짓말이 된다
  const STATUSES = ["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELED_BY_USER", "CANCELED_BY_BIZ", "NO_SHOW", "REJECTED", "EXPIRED"] as const;
  const status = (sp.status ?? "").split(",").filter((x): x is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(x));

  const actor = consoleActor(v);
  const [first, resources, products] = await Promise.all([
    isCal ? Promise.resolve(null) : listReservations(actor, { from, to, ...(status.length ? { status } : {}) }, tz, today),
    listResources(v.membership.businessId),
    listProducts(v.membership.businessId),
  ]);
  // 스코프·"내 담당" 판정은 getCalendar 안에서 목록과 같은 함수로 한다
  const cal = isCal ? await getCalendar(actor, calFrom, calTo) : null;

  const q = (o: Record<string, string>) => "?" + new URLSearchParams({ ...(isCal ? { view: "calendar", span, from: anchor } : { from, to, ...(status.length ? { status: status.join(",") } : {}) }), ...o }).toString();
  const prev = span === "day" ? addDays(anchor, -1) : addDays(anchor, -7);
  const next = span === "day" ? addDays(anchor, 1) : addDays(anchor, 7);

  return (
    <ConsoleShell current="reservations" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>예약</h1>
      <p className="sub" style={{ margin: 0 }}>
        {v.isOwner ? "들어온 예약을 승인하고, 완료·노쇼를 정리하는 곳이에요. 시간을 눌러 상세로 들어가면 처리할 수 있어요." : "내가 담당하는 예약이에요. 시간을 눌러 상세로 들어가면 승인·완료·노쇼를 처리할 수 있어요."}
      </p>

      <div className="chips" role="group" aria-label="보기 전환">
        <Link href={q({ view: "" })} className={isCal ? "chip" : "chip on"} aria-current={isCal ? undefined : "page"}>
          목록
        </Link>
        <Link href={`?view=calendar&span=week&from=${anchor}`} className={isCal && span === "week" ? "chip on" : "chip"} aria-current={isCal && span === "week" ? "page" : undefined}>
          주
        </Link>
        <Link href={`?view=calendar&span=day&from=${anchor}`} className={isCal && span === "day" ? "chip on" : "chip"} aria-current={isCal && span === "day" ? "page" : undefined}>
          일
        </Link>
        {isCal && (
          <span className="cal-nav">
            <Link href={`?view=calendar&span=${span}&from=${prev}`} aria-label="이전">
              ←
            </Link>
            <b>{span === "day" ? calFrom : `${calFrom} ~ ${calTo}`}</b>
            <Link href={`?view=calendar&span=${span}&from=${next}`} aria-label="다음">
              →
            </Link>
            <Link href={`?view=calendar&span=${span}&from=${today}`} className="today">
              오늘
            </Link>
          </span>
        )}
      </div>

      {cal ? (
        <ReservationCalendar data={cal} span={span} resourceNames={new Map(resources.map((r) => [r.id, r.name]))} />
      ) : (
        first && (
          <ReservationsPanel
            initial={first.items}
            initialCursor={first.nextCursor}
            from={from}
            to={to}
            resources={resources.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name }))}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            initialStatus={status}
          />
        )
      )}
    </ConsoleShell>
  );
}
