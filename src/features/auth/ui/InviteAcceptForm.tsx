"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";
import { hardNavigate } from "./safe-next";

const INVITE_TEXT: Record<string, string> = {
  INVITE_INVALID: "초대 링크가 올바르지 않습니다",
  INVITE_EXPIRED: "초대 링크가 만료되었습니다 (72시간). 사업자에게 재발송을 요청해 주세요",
  INVITE_USED: "이미 사용된 초대 링크입니다. 로그인해 주세요",
  INVITE_NOT_INVITED: "이 초대는 더 이상 유효하지 않습니다",
};

type Preview = { businessName: string; name: string; emailMasked: string; needsPassword: boolean };

export function InviteAcceptForm({ token, preview, invalidReason }: { token: string; preview: Preview | null; invalidReason: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(invalidReason ? (INVITE_TEXT[invalidReason] ?? "초대를 확인할 수 없습니다") : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (preview?.needsPassword && password !== confirm) return setErrors({ confirm: "비밀번호가 서로 다릅니다" });
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPost<{ ok: true; email: string }>(`/api/auth/invitations/${token}/accept`, preview?.needsPassword ? { password } : {});
    if (!r.ok) {
      setBusy(false);
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg(INVITE_TEXT[r.error] ?? describeError(r));
      return;
    }
    if (preview?.needsPassword) {
      const s = await signIn("credentials", { email: r.data.email, password, redirect: false });
      setBusy(false);
      if (s && !s.error) return hardNavigate("/console");
    }
    hardNavigate("/login?next=%2Fconsole&invited=ok");
  }

  return (
    <>
      <h1>매니저 초대</h1>
      {preview && (
        <p className="sub">
          <strong>{preview.businessName}</strong> 의 매니저로 초대되었습니다. ({preview.name} · {preview.emailMasked})
        </p>
      )}
      {msg && <Alert kind="error">{msg}</Alert>}
      {preview && (
        <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
          {preview.needsPassword ? (
            <>
              <Field label="비밀번호 설정" htmlFor="password" hint="8자 이상, 영문과 숫자 포함. 콘솔 로그인에 씁니다" error={errors.password}>
                <Input id="password" type="password" required autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
              </Field>
              <Field label="비밀번호 확인" htmlFor="confirm" error={errors.confirm}>
                <Input id="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
              </Field>
            </>
          ) : (
            <Alert kind="info">이미 계정이 있어 비밀번호는 그대로 씁니다. 수락 후 기존 비밀번호로 로그인해 주세요.</Alert>
          )}
          <Button type="submit" variant="primary" block loading={busy}>
            초대 수락
          </Button>
        </form>
      )}
      <div className="links">
        <Link href="/login">로그인으로</Link>
      </div>
    </>
  );
}
