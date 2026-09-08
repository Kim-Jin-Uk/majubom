import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { CompleteProfileForm } from "@/features/auth/ui/CompleteProfileForm";
import { safeNext } from "@/features/auth/ui/safe-next";

export const metadata = { title: "가입 마치기 — 마주,봄" };

export default async function CompleteSignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const s = await auth();
  if (!s) redirect("/login");
  if (!s.pending) redirect(next);
  return (
    <AuthShell>
      <CompleteProfileForm providerLabel={s.pending.provider === "KAKAO" ? "카카오" : "Google"} defaultName={s.pending.name ?? ""} next={next} />
    </AuthShell>
  );
}
