import { auth } from "@/features/auth/auth";

/**
 * 콘솔 공통 레이아웃 — 사업장 상태 배너를 **모든 콘솔 화면에 상시** 노출한다 (FR-AUTH-010 "콘솔 상단에 … 배너 상시 노출").
 * 접근 제어는 프록시가 끝냈다. 여기서는 스냅샷의 businessStatus 만 읽는다.
 */
export default async function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const s = await auth();
  const status = s?.principal?.membership?.businessStatus;
  return (
    <>
      {status === "PENDING" && <div className="banner">심사 중 — 승인되면 예약 페이지가 공개됩니다. 그동안 매장·자원·상품을 준비해 두세요.</div>}
      {status === "REJECTED" && <div className="banner">가입 신청이 반려되었습니다. 메일의 사유를 확인하고 다시 신청할 수 있어요.</div>}
      {status === "SUSPENDED" && <div className="banner">사업장이 일시정지되어 읽기 전용입니다. 예약 취소와 고객 상담은 계속 할 수 있어요.</div>}
      {children}
    </>
  );
}
