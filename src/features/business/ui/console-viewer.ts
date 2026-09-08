import { redirect } from "next/navigation";
import { auth } from "@/features/auth/auth";
import type { Membership } from "@/features/auth/principal";

export type ConsolePageViewer = { uid: string; name: string; membership: Membership; isOwner: boolean; readOnly: boolean };

/**
 * 콘솔 서버 컴포넌트 공용: 스냅샷에서 소속을 읽는다. 접근 제어는 프록시가 끝냈으므로 여기서 없다는 건 경쟁 상태(로그아웃 직후 등) —
 * 로그인으로 보낸다. SUSPENDED 는 읽기 전용(FR-ADM-020) — 폼을 비활성화하는 근거.
 */
export async function consoleViewer(nextPath: string): Promise<ConsolePageViewer> {
  const s = await auth();
  const m = s?.principal?.membership;
  if (!s?.user.id || !m) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { uid: s.user.id, name: s.user.name ?? "", membership: m, isOwner: m.role === "OWNER", readOnly: m.businessStatus === "SUSPENDED" };
}

export function publicBase(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
