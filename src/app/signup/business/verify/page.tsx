import { AuthShell } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { BusinessVerifyForm } from "@/features/auth/ui/BusinessVerifyForm";

export const metadata = { title: "이메일 인증 — 마주,봄" };

export default async function BusinessVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const email = (Array.isArray(sp.email) ? sp.email[0] : sp.email) ?? "";
  const s = await auth();
  return (
    <AuthShell>
      <BusinessVerifyForm initialEmail={email} signedIn={Boolean(s?.user.id)} />
    </AuthShell>
  );
}
