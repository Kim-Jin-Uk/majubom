import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { safeNext } from "@/features/auth/ui/safe-next";
import { TotpForm } from "@/features/auth/ui/TotpForm";

export const metadata = { title: "2단계 인증 — 마주,봄" };

export default async function TotpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next, "/admin");
  const s = await auth();
  if (!s?.user.id) redirect("/login?next=%2Flogin%2Ftotp");
  if (s.principal?.globalRole !== "ADMIN") redirect("/");
  if (s.mfa === "ok") redirect(next);
  return (
    <AuthShell>
      <TotpForm enrolled={s.principal.totpEnabled} next={next} />
    </AuthShell>
  );
}
