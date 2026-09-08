import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { auth, enabledSocialProviders } from "@/features/auth/auth";
import { safeNext } from "@/features/auth/ui/safe-next";
import { SignupForm } from "@/features/auth/ui/SignupForm";

export const metadata = { title: "회원가입 — 마주,봄" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const s = await auth();
  if (s?.pending) redirect("/signup/complete");
  if (s?.user.id) redirect(next);
  return (
    <AuthShell>
      <SignupForm providers={enabledSocialProviders()} next={next} />
    </AuthShell>
  );
}
