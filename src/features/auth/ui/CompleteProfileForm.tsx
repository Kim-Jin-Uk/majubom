"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { hardNavigate } from "./safe-next";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";

/** 소셜 이메일 미제공 — 이메일 1줄(+이름) 만 받고 끝낸다 (FR-AUTH-030). 검증은 메일 링크로 비동기 */
export function CompleteProfileForm({ providerLabel, defaultName, next }: { providerLabel: string; defaultName: string; next: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState(defaultName);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErrors({});
    const r = await apiPost("/api/auth/complete-profile", { email, name });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "EMAIL_TAKEN") setErrors({ email: "이미 사용 중인 이메일입니다. 그 계정으로 로그인해 주세요" });
      else if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg(describeError(r));
      return;
    }
    hardNavigate(next);
  }

  return (
    <>
      <h1>이메일 한 줄만 더</h1>
      <p className="sub">{providerLabel} 계정에 이메일이 없어요. 예약 확정·변경 안내를 받을 이메일을 알려주세요.</p>
      {msg && <Alert kind="error">{msg}</Alert>}
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <Field label="이름" htmlFor="name" error={errors.name}>
          <Input id="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="이메일" htmlFor="email" error={errors.email} hint="확인 메일을 보내드려요. 확인 전에도 예약은 바로 할 수 있어요.">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          가입 마치기
        </Button>
      </form>
    </>
  );
}
