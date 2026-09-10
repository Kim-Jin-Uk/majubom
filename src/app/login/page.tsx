import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { auth, enabledSocialProviders } from "@/features/auth/auth";
import { LoginForm } from "@/features/auth/ui/LoginForm";
import { safeNext } from "@/features/auth/ui/safe-next";

export const metadata = { title: "로그인 — 마주,봄" };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const next = safeNext(first(sp.next));
  const s = await auth();
  // 복귀 경로를 그대로 넘긴다. 안 넘기면 소셜이 이메일을 안 준 손님만 가입을 마친 뒤 홈으로 떨어진다 —
  // 예약 위젯에서 오면 고르던 것이 통째로 사라진 것처럼 보인다 (#83)
  if (s?.pending) redirect(next === "/" ? "/signup/complete" : `/signup/complete?next=${encodeURIComponent(next)}`);
  // next 가 기본값(/)인 사업자·매니저는 콘솔로 — 고객 홈은 그들의 "다음" 이 아니다
  if (s?.user.id) redirect(next === "/" && s.principal?.membership?.memberStatus === "ACTIVE" ? "/console" : next);
  return (
    <AuthShell>
      <LoginForm providers={enabledSocialProviders()} next={next} error={first(sp.error)} code={first(sp.code)} reason={first(sp.reason)} verified={first(sp.verified)} notice={first(sp.reset) === "ok" ? "reset" : first(sp.invited) === "ok" ? "invited" : null} />
    </AuthShell>
  );
}
