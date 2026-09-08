import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/ui";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auth } from "@/features/auth/auth";
import { BusinessSignupForm } from "@/features/auth/ui/BusinessSignupForm";

export const metadata = { title: "사업자 가입 — 마주,봄" };

/**
 * 사업자 가입 신청. 같은 이메일로 고객·사업자를 겸할 수 있다 — 계정은 하나고 사업장이 붙는 것.
 * 로그인한 고객이면 그 계정으로 신청(이메일·비밀번호 입력 없음), 아니면 이메일·비밀번호를 받되 기존 계정이면 비밀번호로 본인 확인.
 */
export default async function BusinessSignupPage() {
  const s = await auth();
  if (s?.principal?.membership) redirect("/console"); // 이미 소속 사업장이 있으면 콘솔로 (1계정 1사업장)
  let account: { email: string; name: string } | null = null;
  if (s?.user.id) {
    const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, s.user.id)).limit(1);
    if (u) account = u;
  }
  return (
    <AuthShell wide>
      <BusinessSignupForm account={account} />
    </AuthShell>
  );
}
