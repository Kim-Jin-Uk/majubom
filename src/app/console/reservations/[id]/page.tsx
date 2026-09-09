import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { HttpError } from "@/features/auth/errors";
import { consoleActor, getReservation } from "@/features/booking/console";
import { ReservationDetailPanel } from "@/features/booking/ui/ReservationDetailPanel";
import { loadConsoleBusiness } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";

export const metadata = { title: "예약 상세 — 마주,봄 콘솔" };

/** 예약 상세 (FR-BOOK-080, #61). 남의 사업장·매니저 범위 밖은 404 — 존재를 알리지 않는다 (#63) */
export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await consoleViewer("/console/reservations");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { settings } = await loadConsoleBusiness(v.membership.businessId);

  const detail = await getReservation(consoleActor(v), id, settings.timezone).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  const resources = v.isOwner ? await listResources(v.membership.businessId) : [];

  return (
    <ConsoleShell current="reservations" viewer={{ name: v.name, role: v.membership.role }}>
      <p style={{ margin: 0, fontSize: 13.5 }}>
        <Link href="/console/reservations">← 예약 목록</Link>
      </p>
      <h1>예약 {detail.code}</h1>
      <ReservationDetailPanel detail={detail} role={v.membership.role} readOnly={v.readOnly} resources={resources.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive }))} />
    </ConsoleShell>
  );
}
