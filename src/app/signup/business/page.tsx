import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { auth } from "@/features/auth/auth";
import { BusinessSignupForm } from "@/features/auth/ui/BusinessSignupForm";

export const metadata = { title: "사업자 가입 — 마주,봄" };

export default async function BusinessSignupPage() {
  const s = await auth();
  // 이미 소속 사업장이 있으면 콘솔로. 로그인만 한 고객은 그대로 신청 가능 (고객 → 사업자 전환은 별도 이메일로)
  if (s?.principal?.membership) redirect("/console");
  return (
    <AuthShell wide>
      <BusinessSignupForm />
    </AuthShell>
  );
}
