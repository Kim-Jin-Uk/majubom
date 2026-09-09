import { listReservations, consoleActor } from "@/features/booking/console";
import { ReservationsPanel } from "@/features/booking/ui/ReservationsPanel";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { listProducts } from "@/features/product/products";
import { addDays } from "@/features/schedule/resolve";
import { isoDateSchema, todayIn } from "@/lib/dates";

export const metadata = { title: "예약 — 마주,봄 콘솔" };

/**
 * 예약 목록 (FR-BOOK-080, #60). 기본 기간은 오늘부터 7일 — ?from 으로 옮길 수 있다(대시보드에서 넘어올 때).
 * 첫 페이지는 서버가 그린다. 이후 필터·더 보기는 패널이 API 를 친다.
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

  const [first, resources, products] = await Promise.all([listReservations(consoleActor(v), { from, to }, tz, today), listResources(v.membership.businessId), listProducts(v.membership.businessId)]);

  return (
    <ConsoleShell current="reservations" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>예약</h1>
      <p className="sub" style={{ margin: 0 }}>
        {v.isOwner ? "들어온 예약을 승인하고, 완료·노쇼를 정리하는 곳이에요. 시간을 눌러 상세로 들어가면 처리할 수 있어요." : "내가 담당하는 예약이에요. 시간을 눌러 상세로 들어가면 승인·완료·노쇼를 처리할 수 있어요."}
      </p>
      <ReservationsPanel
        initial={first.items}
        initialCursor={first.nextCursor}
        from={from}
        to={to}
        resources={resources.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name }))}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        role={v.membership.role}
      />
    </ConsoleShell>
  );
}
