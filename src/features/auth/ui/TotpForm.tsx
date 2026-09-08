"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPost, describeError } from "@/lib/client-api";
import { hardNavigate } from "./safe-next";

/**
 * ADMIN 2단계 인증. 등록 전이면 시크릿을 발급해 보여주고(인증 앱에 수동 입력 — QR 라이브러리는 두지 않는다), 코드로 확인하면 활성화.
 * 등록 후에는 코드만.
 */
export function TotpForm({ enrolled, next }: { enrolled: boolean; next: string }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    const r = await apiPost<{ secret: string; uri: string }>("/api/auth/totp/setup", {});
    setBusy(false);
    if (!r.ok) return setMsg(describeError(r));
    setSetup(r.data);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await apiPost<{ ok: true; enabledNow: boolean }>("/api/auth/totp/verify", { code });
    if (!r.ok) {
      setBusy(false);
      setMsg(r.error === "TOTP_INVALID" ? "코드가 맞지 않습니다" : r.error === "TOTP_NO_SECRET" ? "먼저 인증 앱 등록을 시작해 주세요" : describeError(r));
      return;
    }
    hardNavigate(next);
  }

  return (
    <>
      <h1>관리자 2단계 인증</h1>
      <p className="sub">{enrolled ? "인증 앱의 6자리 코드를 입력해 주세요." : "관리자 계정은 TOTP 2단계 인증이 필수입니다. 인증 앱(Google Authenticator, 1Password 등)에 등록해 주세요."}</p>
      {msg && <Alert kind="error">{msg}</Alert>}
      {!enrolled && !setup && (
        <Button type="button" variant="primary" block onClick={begin} loading={busy}>
          인증 앱 등록 시작
        </Button>
      )}
      {setup && (
        <div className="form" style={{ marginBottom: 14 }}>
          <Alert kind="info">
            인증 앱에서 &ldquo;설정 키 입력&rdquo;을 선택해 아래 키를 넣으세요 (시간 기반, 6자리).
            <div style={{ marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 15, letterSpacing: "0.08em", wordBreak: "break-all" }}>{setup.secret}</div>
            <div style={{ marginTop: 8 }}>
              <a href={setup.uri} style={{ textDecoration: "underline" }}>
                같은 기기의 인증 앱으로 바로 열기
              </a>
            </div>
          </Alert>
        </div>
      )}
      {(enrolled || setup) && (
        <form className="form" onSubmit={verify}>
          <Field label="인증 코드" htmlFor="code">
            <Input id="code" className="input--otp" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            {enrolled ? "확인" : "등록 완료"}
          </Button>
        </form>
      )}
    </>
  );
}
