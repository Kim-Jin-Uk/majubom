"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Divider, Field, Input } from "@/components/ui";
import { hardNavigate } from "./safe-next";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";
import { SocialButtons } from "./SocialButtons";

export function SignupForm({ providers, next }: { providers: Array<"kakao" | "google">; next: string }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErrors({});
    if (form.password !== form.confirm) return setErrors({ confirm: "비밀번호가 서로 다릅니다" });
    setBusy(true);
    const r = await apiPost("/api/auth/signup", { name: form.name, email: form.email, password: form.password });
    if (!r.ok) {
      setBusy(false);
      if (r.error === "EMAIL_TAKEN") setErrors({ email: "이미 가입된 이메일입니다. 로그인해 주세요 — 사업자 계정도 같은 계정으로 예약할 수 있어요" });
      else if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg(describeError(r));
      return;
    }
    const s = await signIn("credentials", { email: form.email, password: form.password, redirect: false });
    setBusy(false);
    if (!s || s.error) {
      hardNavigate(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    hardNavigate(next);
  }

  // 입력을 고치면 그 필드의 오류 문구는 바로 지운다 (재제출 전까지 남아 있으면 "고쳤는데 왜 그대로지" 가 된다)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));
  };

  return (
    <>
      <h1>회원가입</h1>
      <p className="sub">이메일은 알림을 받을 주소로 쓰여요. 가입 후 확인 메일을 보내드립니다.</p>
      {msg && <Alert kind="error">{msg}</Alert>}
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <Field label="이름" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" required maxLength={100} value={form.name} onChange={set("name")} aria-invalid={!!errors.name} />
        </Field>
        <Field label="이메일" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="비밀번호" htmlFor="password" hint="8자 이상, 영문과 숫자 포함" error={errors.password}>
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} aria-invalid={!!errors.password} />
        </Field>
        <Field label="비밀번호 확인" htmlFor="confirm" error={errors.confirm}>
          <Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} aria-invalid={!!errors.confirm} />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          가입하기
        </Button>
      </form>
      {providers.length > 0 && (
        <>
          <Divider>또는</Divider>
          <SocialButtons providers={providers} next={next} />
        </>
      )}
      <div className="links">
        <Link href={`/login?next=${encodeURIComponent(next)}`}>이미 계정이 있어요</Link>
        <Link href="/signup/business">사업자로 가입</Link>
      </div>
    </>
  );
}
