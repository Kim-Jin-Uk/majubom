"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { MemberListItem } from "@/features/auth/members";
import { apiPatch, apiPost, describeError, fieldErrors } from "@/lib/client-api";

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
  OWNER_NOT_EDITABLE: "사업자 본인은 바꿀 수 없습니다",
  NOT_INACTIVE: "이미 활동 중인 구성원입니다",
  NOT_ACTIVE: "초대를 아직 수락하지 않은 구성원은 비활성화할 수 없습니다",
};

/** FR-AUTH-020 매니저 초대·목록·재발송. 서버 컴포넌트가 초기 목록을 넘기고, 변경 후에는 GET 으로 다시 읽는다 */
export function MembersPanel({ initial, isOwner }: { initial: MemberListItem[]; isOwner: boolean }) {
  const router = useRouter();
  const [members, setMembers] = useState(initial);
  // 서버가 다시 렌더(router.refresh)하면 새 목록을 따른다 — 같은 화면의 자원 패널이 바꾼 것도 보여야 한다 (렌더 중 상태 조정 패턴)
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setMembers(initial);
  }
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 권한 편집 중인 매니저 id 와 체크 상태 */
  const [editing, setEditing] = useState<{ id: string; perms: Record<string, boolean> } | null>(null);

  async function savePerms() {
    if (!editing) return;
    setBusy(true);
    const r = await apiPatch(`/api/console/members/${editing.id}`, { permissions: editing.perms });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
      return;
    }
    setEditing(null);
    setMsg({ kind: "ok", text: "권한을 저장했습니다. 다음 요청부터 바로 적용됩니다." });
    await reload();
  }

  async function setActive(m: MemberListItem, active: boolean) {
    if (!active && !confirm(`${m.name} 님을 비활성화할까요? 로그인 세션이 모두 끊기고 콘솔에 들어올 수 없게 됩니다. 담당자로 연결된 자원은 비활성화되고 기존 예약은 유지됩니다.`)) return;
    setBusy(true);
    const r = await apiPatch(`/api/console/members/${m.id}`, { active });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
      return;
    }
    setMsg({ kind: "ok", text: active ? `${m.name} 님을 다시 활성화했습니다. 다시 로그인하면 콘솔을 쓸 수 있어요. 담당자 자원은 비활성 상태로 남아 있으니 필요하면 다시 켜 주세요.` : `${m.name} 님을 비활성화했습니다.` });
    await reload();
  }

  async function reload() {
    const r = await fetch("/api/console/members", { credentials: "same-origin" });
    if (r.ok) setMembers(((await r.json()) as { members: MemberListItem[] }).members);
    router.refresh(); // 초대·비활성화는 자원(STAFF)도 바꾼다 — 형제 패널이 새 데이터를 받게
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
                  {m.role === "OWNER" ? (
                    "전체"
                  ) : editing?.id === m.id ? (
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 10 }}>
                      {PERMS.map(([k, label]) => (
                        <label key={k} className="check" style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!editing.perms[k]} onChange={(e) => setEditing((x) => (x ? { ...x, perms: { ...x.perms, [k]: e.target.checked } } : x))} />
                          {label}
                        </label>
                      ))}
                    </span>
                  ) : (
                    PERMS.filter(([k]) => m.permissions[k]).map(([, l]) => l).join(" · ") || "—"
                  )}
                </td>
                {isOwner && (
                  <td>
                    {m.role === "MANAGER" && (
                      <span className="actions" style={{ flexWrap: "nowrap" }}>
                        {m.status === "INVITED" && (
                          <Button size="sm" type="button" onClick={() => resend(m.id)} disabled={busy}>
                            재발송
                          </Button>
                        )}
                        {editing?.id === m.id ? (
                          <>
                            <Button size="sm" type="button" variant="primary" onClick={savePerms} loading={busy}>
                              저장
                            </Button>
                            <Button size="sm" type="button" onClick={() => setEditing(null)} disabled={busy}>
                              취소
                            </Button>
                          </>
                        ) : (
                          m.status !== "INACTIVE" && (
                            <Button size="sm" type="button" onClick={() => setEditing({ id: m.id, perms: { ...m.permissions } as Record<string, boolean> })} disabled={busy}>
                              권한
                            </Button>
                          )
                        )}
                        {m.status === "INACTIVE" && (
                          <Button size="sm" type="button" onClick={() => setActive(m, true)} disabled={busy}>
                            재활성화
                          </Button>
                        )}
                        {m.status === "ACTIVE" && (
                          <Button size="sm" type="button" variant="danger" onClick={() => setActive(m, false)} disabled={busy}>
                            비활성화
                          </Button>
                        )}
                      </span>
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
