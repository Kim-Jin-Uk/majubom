"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Divider, Field, Input } from "@/components/ui";
import { hardNavigate } from "./safe-next";
import { SocialButtons } from "./SocialButtons";

const ERROR_TEXT: Record<string, string> = {
  invalid: "이메일 또는 비밀번호가 맞지 않습니다",
  locked: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요",
  inactive: "이용이 정지된 계정입니다. 문의해 주세요",
  email_taken: "같은 이메일의 계정이 이미 있습니다. 이메일로 로그인한 뒤 소셜 계정을 연결해 주세요",
  CredentialsSignin: "이메일 또는 비밀번호가 맞지 않습니다",
  AccessDenied: "로그인할 수 없는 계정입니다",
  OAuthAccountNotLinked: "같은 이메일의 계정이 이미 있습니다",
};

const REASON_TEXT: Record<string, string> = {
  REFRESH_EXPIRED: "로그인이 만료되었습니다. 다시 로그인해 주세요",
  REFRESH_REVOKED: "다른 곳에서 로그아웃되어 다시 로그인이 필요합니다",
  REFRESH_MISMATCH: "보안을 위해 로그아웃되었습니다. 다시 로그인해 주세요",
  USER_INACTIVE: "이용이 정지된 계정입니다",
  MEMBER_INACTIVE: "사업장 접근 권한이 없습니다. 초대를 먼저 수락하거나 사업자에게 문의하세요",
  BUSINESS_BLOCKED: "사업장이 차단되어 콘솔에 접근할 수 없습니다",
  TOTP_HARD_LOCK: "2단계 인증 실패가 너무 많아 로그아웃되었습니다. 다시 로그인해 주세요",
};

export function LoginForm({ providers, next, error, code, reason, verified, notice }: { providers: Array<"kakao" | "google">; next: string; error?: string; code?: string; reason?: string; verified?: string; notice?: "reset" | "invited" | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ? (ERROR_TEXT[code ?? ""] ?? ERROR_TEXT[error] ?? "로그인에 실패했습니다") : reason ? (REASON_TEXT[reason] ?? null) : null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (!r || r.error) {
      setMsg(ERROR_TEXT[r?.code ?? ""] ?? ERROR_TEXT[r?.error ?? ""] ?? "로그인에 실패했습니다");
      return;
    }
    // 기본 목적지(/)면 로그인 페이지를 한 번 더 거친다 — 서버가 소속(사업자·매니저)을 보고 /console 로 보낸다
    hardNavigate(next === "/" ? "/login?next=%2F" : next);
  }

  return (
    <>
      <h1>로그인</h1>
      <p className="sub">예약·상담·리뷰는 로그인 후 이용할 수 있어요.</p>
      {notice === "reset" && <Alert kind="ok">비밀번호를 바꿨습니다. 모든 기기에서 로그아웃되었으니 새 비밀번호로 로그인해 주세요.</Alert>}
      {notice === "invited" && <Alert kind="ok">초대를 수락했습니다. 기존 비밀번호로 로그인하면 콘솔이 열립니다.</Alert>}
      {verified === "ok" && <Alert kind="ok">이메일 확인이 끝났습니다. 로그인해 주세요.</Alert>}
      {verified && verified !== "ok" && <Alert kind="warn">이메일 확인 링크가 {verified === "used" ? "이미 사용되었습니다" : verified === "expired" ? "만료되었습니다" : "올바르지 않습니다"}. 로그인 후 다시 요청할 수 있어요.</Alert>}
      {msg && <Alert kind="error">{msg}</Alert>}
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <Field label="이메일" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="비밀번호" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          로그인
        </Button>
      </form>
      {providers.length > 0 && (
        <>
          <Divider>또는</Divider>
          <SocialButtons providers={providers} next={next} />
        </>
      )}
      <div className="links">
        <Link href={`/signup?next=${encodeURIComponent(next)}`}>회원가입</Link>
        <Link href="/forgot-password">비밀번호를 잊었어요</Link>
        <Link href="/signup/business">사업자 가입</Link>
      </div>
    </>
  );
}
