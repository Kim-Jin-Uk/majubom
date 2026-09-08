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
  if (s?.pending) redirect("/signup/complete");
  if (s?.user.id) redirect(next);
  return (
    <AuthShell>
      <LoginForm providers={enabledSocialProviders()} next={next} error={first(sp.error)} code={first(sp.code)} reason={first(sp.reason)} verified={first(sp.verified)} />
    </AuthShell>
  );
}
