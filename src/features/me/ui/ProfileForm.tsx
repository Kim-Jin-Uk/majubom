"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { apiPut, describeError } from "@/lib/client-api";

/** 프로필 (FR-NOTI-030, #90). 이메일은 읽기 전용 — 로그인 아이디라 여기서 바꾸지 않는다 */
export function ProfileForm({ initial }: { initial: { name: string; email: string; phone: string | null } }) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await apiPut("/api/me/profile", { name, phone });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: "저장했어요" } : { kind: "error", text: describeError(r) });
  }

  return (
    <section className="panel">
      <h2>내 정보</h2>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Field label="이름" htmlFor="me-name">
        <Input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </Field>
      <Field label="연락처" htmlFor="me-phone" hint="매장이 급히 연락할 때 씁니다. 비워 두셔도 돼요.">
        <Input id="me-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="010-1234-5678" />
      </Field>
      <Field label="이메일" htmlFor="me-email" hint="로그인 아이디예요. 바꾸시려면 고객센터로 알려 주세요.">
        <Input id="me-email" value={initial.email} readOnly disabled />
      </Field>
      <div className="actions">
        <Button type="button" variant="primary" loading={busy} onClick={() => void save()} disabled={!name.trim()}>
          저장
        </Button>
      </div>
    </section>
  );
}
