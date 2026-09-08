"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { MemberListItem } from "@/features/auth/members";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";

/** 권한 4종 — business_members.permissions 키와 같다 (#30 에서 라벨·설명 확정) */
const PERMS: Array<[keyof MemberListItem["permissions"], string]> = [
  ["editProduct", "상품 수정"],
  ["replyReview", "리뷰 답글"],
  ["viewAllReservations", "전체 예약 열람"],
  ["handleChat", "채팅 응대"],
];

const STATUS_TEXT = { INVITED: "초대 대기", ACTIVE: "활동 중", INACTIVE: "비활성" } as const;

const ERR_TEXT: Record<string, string> = {
  ALREADY_MEMBER: "이미 사용 중인 계정입니다 (다른 사업장 소속 또는 초대됨)",
  RESOURCE_NOT_LINKABLE: "연결할 수 없는 자원입니다",
  READ_ONLY: "일시정지 상태라 구성원을 바꿀 수 없습니다",
  OWNER_ONLY: "사업자만 초대할 수 있습니다",
};

/** FR-AUTH-020 매니저 초대·목록·재발송. 서버 컴포넌트가 초기 목록을 넘기고, 변경 후에는 GET 으로 다시 읽는다 */
export function MembersPanel({ initial, isOwner }: { initial: MemberListItem[]; isOwner: boolean }) {
  const [members, setMembers] = useState(initial);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const r = await fetch("/api/console/members", { credentials: "same-origin" });
    if (r.ok) setMembers(((await r.json()) as { members: MemberListItem[] }).members);
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPost("/api/console/members", { ...form, phone: form.phone || undefined, permissions: perms });
    setBusy(false);
    if (!r.ok) {
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg({ kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
      return;
    }
    setMsg({ kind: "ok", text: `${form.name} 님에게 초대 메일을 보냈습니다. 72시간 안에 수락하면 활동 중으로 바뀝니다.` });
    setForm({ name: "", email: "", phone: "" });
    setPerms({});
    await reload();
  }

  async function resend(id: string) {
    setBusy(true);
    const r = await apiPost(`/api/console/members/${id}/resend-invite`, {});
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: "초대 메일을 다시 보냈습니다. 이전 링크는 무효화됩니다." } : { kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>역할</th>
              <th>상태</th>
              <th>권한</th>
              {isOwner && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="muted">{m.emailMasked}</td>
                <td>{m.role === "OWNER" ? "사업자" : "매니저"}</td>
                <td>
                  <span className="tag">{STATUS_TEXT[m.status]}</span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {m.role === "OWNER" ? "전체" : PERMS.filter(([k]) => m.permissions[k]).map(([, l]) => l).join(" · ") || "—"}
                </td>
                {isOwner && (
                  <td>
                    {m.status === "INVITED" && (
                      <Button size="sm" type="button" onClick={() => resend(m.id)} disabled={busy}>
                        재발송
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isOwner && (
        <form className="form" onSubmit={invite}>
          <h2 style={{ margin: "8px 0 0", fontSize: 16 }}>매니저 초대</h2>
          <p className="sub" style={{ marginBottom: 0 }}>
            초대 링크(72시간·1회)를 메일로 보냅니다. 매니저가 직접 비밀번호를 정해요 — 임시 비밀번호는 만들지 않습니다. 같은 이름으로 등록된 담당자(STAFF 자원)가 있으면 그 자원에 연결되고, 없으면 새로 만들어져 근무표에 편입됩니다.
          </p>
          <div className="row">
            <Field label="이름" htmlFor="m-name" error={errors.name}>
              <Input id="m-name" required value={form.name} onChange={set("name")} aria-invalid={!!errors.name} />
            </Field>
            <Field label="연락처 (선택)" htmlFor="m-phone" error={errors.phone}>
              <Input id="m-phone" type="tel" value={form.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
            </Field>
          </div>
          <Field label="이메일" htmlFor="m-email" error={errors.email}>
            <Input id="m-email" type="email" required value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--text-4)", marginBottom: 6 }}>세부 권한</legend>
            {PERMS.map(([k, label]) => (
              <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={!!perms[k]} onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="primary" loading={busy}>
            초대 메일 보내기
          </Button>
        </form>
      )}
    </div>
  );
}
