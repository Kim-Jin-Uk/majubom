import { AuthShell } from "@/components/ui";
import { previewPasswordReset } from "@/features/auth/password-reset";
import { ResetPasswordForm } from "@/features/auth/ui/ResetPasswordForm";

export const metadata = { title: "새 비밀번호 — 마주,봄" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await previewPasswordReset(token);
  return (
    <AuthShell>
      <ResetPasswordForm token={token} invalidReason={r.ok ? null : `TOKEN_${r.reason}`} />
    </AuthShell>
  );
}
