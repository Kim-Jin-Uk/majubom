"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError } from "@/lib/client-api";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiPost("/api/auth/password-reset", { email });
    setBusy(false);
    if (!r.ok) return setMsg(describeError(r));
    setDone(true);
  }

  return (
    <>
      <h1>비밀번호 재설정</h1>
      <p className="sub">가입한 이메일을 입력하면 재설정 링크를 보내드려요. 링크는 30분 동안 한 번만 쓸 수 있어요.</p>
      {done ? (
        <Alert kind="ok">메일을 보냈습니다. 받은편지함(스팸함 포함)을 확인해 주세요. 소셜 계정으로 가입했다면 그 방법으로 로그인하라는 안내가 갑니다.</Alert>
      ) : (
        <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
          {msg && <Alert kind="error">{msg}</Alert>}
          <Field label="이메일" htmlFor="email">
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            재설정 링크 보내기
          </Button>
        </form>
      )}
      <div className="links">
        <Link href="/login">로그인으로</Link>
      </div>
    </>
  );
}
