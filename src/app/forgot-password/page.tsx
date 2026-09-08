import { AuthShell } from "@/components/ui";
import { ForgotPasswordForm } from "@/features/auth/ui/ForgotPasswordForm";

export const metadata = { title: "비밀번호 재설정 — 마주,봄" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
