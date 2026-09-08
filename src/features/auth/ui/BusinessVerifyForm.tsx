"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError } from "@/lib/client-api";
import { hardNavigate } from "./safe-next";

const OTP_TEXT: Record<string, string> = {
  OTP_INVALID: "인증번호가 맞지 않습니다",
  OTP_EXPIRED: "인증번호가 만료되었습니다. 다시 받아 주세요",
  OTP_TOO_MANY: "틀린 횟수가 많아 인증번호가 무효화되었습니다. 다시 받아 주세요",
  OTP_NONE: "진행 중인 인증이 없습니다. 인증번호를 다시 받아 주세요",
};

/**
 * FR-AUTH-010 이메일 OTP 검증. 성공 → (비밀번호를 아직 갖고 있으면) 자동 로그인 → /console, 아니면 /login.
 * 가입 직후 넘어온 경우 비밀번호는 없다 — 검증 후 로그인 화면으로 보낸다. 로그인 상태에서 프록시가 보낸 경우(미검증 콘솔 접근)는
 * 검증 후 곧바로 콘솔로.
 */
export function BusinessVerifyForm({ initialEmail, signedIn }: { initialEmail: string; signedIn: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "ok" | "info"; text: string } | null>({ kind: "info", text: "메일로 보낸 6자리 인증번호를 입력해 주세요. 10분 안에 입력해야 합니다." });
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await apiPost("/api/auth/business-signup/verify", { email, code });
    if (!r.ok) {
      setBusy(false);
      setMsg({ kind: "error", text: OTP_TEXT[r.error] ?? describeError(r) });
      return;
    }
    if (signedIn) {
      // 프록시가 새 스냅샷을 읽도록 전체 이동
      hardNavigate("/console");
      return;
    }
    hardNavigate(`/login?next=${encodeURIComponent("/console")}&verified=ok`);
  }

  async function resend() {
    setBusy(true);
    const r = await apiPost("/api/auth/business-signup/resend", { email });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: "인증번호를 다시 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요." } : { kind: "error", text: describeError(r) });
  }

  return (
    <>
      <h1>이메일 인증</h1>
      <p className="sub">사업자 가입 신청이 저장되었습니다. 이메일 인증을 마치면 콘솔이 열립니다.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <Field label="이메일" htmlFor="email">
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!initialEmail} />
        </Field>
        <Field label="인증번호" htmlFor="code">
          <Input id="code" className="input--otp" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          인증하기
        </Button>
        <Button type="button" block size="sm" onClick={resend} disabled={busy}>
          인증번호 다시 받기
        </Button>
      </form>
    </>
  );
}
