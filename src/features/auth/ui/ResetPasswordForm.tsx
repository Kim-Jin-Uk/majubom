"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";

const TOKEN_TEXT: Record<string, string> = {
  TOKEN_INVALID: "링크가 올바르지 않습니다",
  TOKEN_EXPIRED: "링크가 만료되었습니다 (30분). 다시 요청해 주세요",
  TOKEN_USED: "이미 사용된 링크입니다",
};

export function ResetPasswordForm({ token, invalidReason }: { token: string; invalidReason: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(invalidReason ? (TOKEN_TEXT[invalidReason] ?? "링크를 확인할 수 없습니다") : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErrors({ confirm: "비밀번호가 서로 다릅니다" });
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPost("/api/auth/password-reset/confirm", { token, password });
    setBusy(false);
    if (!r.ok) {
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg(TOKEN_TEXT[r.error] ?? describeError(r));
      return;
    }
    // 이 브라우저에 세션이 남아 있을 수 있다(로그인 상태에서 재설정) — 명세대로 전 세션 폐기이므로 여기서도 로그아웃한다
    await signOut({ redirectTo: "/login?reset=ok" });
  }

  return (
    <>
      <h1>새 비밀번호</h1>
      <p className="sub">재설정하면 모든 기기에서 로그아웃됩니다.</p>
      {msg && <Alert kind="error">{msg}</Alert>}
      {!invalidReason && (
        <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
          <Field label="새 비밀번호" htmlFor="password" hint="8자 이상, 영문과 숫자 포함" error={errors.password}>
            <Input id="password" type="password" required autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
          </Field>
          <Field label="새 비밀번호 확인" htmlFor="confirm" error={errors.confirm}>
            <Input id="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            비밀번호 바꾸기
          </Button>
        </form>
      )}
      <div className="links">
        <Link href="/forgot-password">링크 다시 요청</Link>
        <Link href="/login">로그인으로</Link>
      </div>
    </>
  );
}
