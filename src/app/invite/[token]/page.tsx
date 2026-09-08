import { AuthShell } from "@/components/ui";
import { previewInvite } from "@/features/auth/members";
import { InviteAcceptForm } from "@/features/auth/ui/InviteAcceptForm";

export const metadata = { title: "매니저 초대 — 마주,봄" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await previewInvite(token);
  return (
    <AuthShell>
      <InviteAcceptForm token={token} preview={r.ok ? r : null} invalidReason={r.ok ? null : `INVITE_${r.reason}`} />
    </AuthShell>
  );
}
