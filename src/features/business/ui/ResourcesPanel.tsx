"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { MemberListItem } from "@/features/auth/members";
import type { RemoveResult, ResourceItem } from "@/features/business/resources";
import { apiDelete, apiPatch, apiPost, apiPut, describeError, fieldErrors } from "@/lib/client-api";

const TYPE_TEXT = { STAFF: "담당자", SPACE: "공간", SHARED: "공용" } as const;
const TYPE_HINT: Record<ResourceItem["type"], string> = {
  STAFF: "사람이 응대하는 예약 — 네일·헤어·PT·상담. 계정을 연결하면 본인 예약만 볼 수 있어요",
  SPACE: "공간을 시간 단위로 빌리는 예약 — 스터디룸·스튜디오·회의실",
  SHARED: "여러 상품이 함께 쓰는 자원 — 수업용 강의실, 공용 장비",
};

const ERR_TEXT: Record<string, string> = {
  MEMBER_ALREADY_LINKED: "그 구성원은 이미 다른 담당자에 연결돼 있습니다",
};

type Draft = { type: ResourceItem["type"]; name: string; description: string; capacity: string; memberId: string };
const EMPTY: Draft = { type: "STAFF", name: "", description: "", capacity: "1", memberId: "" };

/**
 * 자원 목록·등록·수정·정렬·활성 토글·삭제 (FR-RES-010, #28). 위저드 2단계와 /console/resources 가 같이 쓴다.
 * 삭제는 서버가 판단한다 — 예약 이력이 있으면 비활성화로 대체되고 결과(mode)를 알려준다.
 */
export function ResourcesPanel({ initial, members, isOwner, readOnly, mode }: { initial: ResourceItem[]; members: MemberListItem[]; isOwner: boolean; readOnly: boolean; mode: "wizard" | "page" }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  // 구성원 패널의 초대(STAFF 자동 생성)·비활성화가 router.refresh 로 새 initial 을 넘긴다 — 렌더 중 상태 조정 패턴
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setItems(initial);
  }
  const [editing, setEditing] = useState<string | "new" | null>(mode === "wizard" && initial.length === 0 ? "new" : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = isOwner && !readOnly;

  async function reload() {
    const r = await fetch("/api/console/resources", { credentials: "same-origin" });
    if (r.ok) setItems(((await r.json()) as { resources: ResourceItem[] }).resources);
    router.refresh();
  }

  function startNew() {
    setDraft(EMPTY);
    setErrors({});
    setEditing("new");
  }
  function startEdit(r: ResourceItem) {
    setDraft({ type: r.type, name: r.name, description: r.description ?? "", capacity: String(r.capacity), memberId: r.memberId ?? "" });
    setErrors({});
    setEditing(r.id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const body = {
      type: draft.type,
      name: draft.name,
      description: draft.description || null,
      capacity: Number(draft.capacity),
      memberId: draft.type === "STAFF" && draft.memberId ? draft.memberId : null,
    };
    const r = editing === "new" ? await apiPost("/api/console/resources", body) : await apiPut(`/api/console/resources/${editing}`, body);
    setBusy(false);
    if (!r.ok) {
      if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg({ kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
      return;
    }
    setEditing(null);
    setMsg({ kind: "ok", text: editing === "new" ? `「${draft.name}」 등록했습니다` : "저장했습니다" });
    await reload();
  }

  async function toggle(r: ResourceItem) {
    setBusy(true);
    const x = await apiPatch(`/api/console/resources/${r.id}/active`, { isActive: !r.isActive });
    setBusy(false);
    if (!x.ok) setMsg({ kind: "error", text: describeError(x) });
    await reload();
  }

  async function remove(r: ResourceItem) {
    if (!confirm(`「${r.name}」 삭제할까요? 예약 이력이 있으면 삭제 대신 비활성화됩니다.`)) return;
    setBusy(true);
    const x = await apiDelete<RemoveResult>(`/api/console/resources/${r.id}`);
    setBusy(false);
    if (!x.ok) setMsg({ kind: "error", text: describeError(x) });
    else if (x.data.mode === "DELETED") setMsg({ kind: "ok", text: `「${r.name}」 삭제했습니다` });
    else setMsg({ kind: "warn", text: `「${r.name}」 예약 이력이 있어 삭제하지 않고 비활성화했습니다${x.data.futureReservations ? ` (앞으로의 예약 ${x.data.futureReservations}건은 그대로 유지)` : ""}` });
    await reload();
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    const x = await apiPut("/api/console/resources/reorder", { ids: next.map((r) => r.id) });
    if (!x.ok) {
      setMsg({ kind: "error", text: describeError(x) });
      await reload();
    }
  }

  const linkable = members.filter((m) => m.status !== "INACTIVE" && (!items.some((r) => r.memberId === m.id) || (editing !== "new" && items.find((r) => r.id === editing)?.memberId === m.id)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {items.length === 0 && editing !== "new" && <Alert kind="info">아직 등록한 담당자·공간이 없어요. 예약이 점유하는 것(사람·방·장비)을 하나 이상 등록해야 상품을 만들 수 있어요.</Alert>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((r, i) => (
          <div key={r.id} className={r.isActive ? "res-card" : "res-card off"}>
            <div className="ic">{TYPE_TEXT[r.type]}</div>
            <div className="body">
              <b>{r.name}</b>
              {!r.isActive && <span className="tag" style={{ marginLeft: 8, background: "var(--muted-fill)", color: "var(--text-2)" }}>비활성</span>}
              <div className="meta">
                정원 {r.capacity}명
                {r.member ? ` · ${r.member.name} 계정 연결${r.member.status === "INVITED" ? " (초대 대기)" : ""}` : r.type === "STAFF" ? " · 계정 없음" : ""}
                {r.description ? ` · ${r.description}` : ""}
              </div>
            </div>
            {canEdit && (
              <div className="actions">
                <Button size="sm" type="button" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label="위로">
                  ↑
                </Button>
                <Button size="sm" type="button" onClick={() => move(i, 1)} disabled={busy || i === items.length - 1} aria-label="아래로">
                  ↓
                </Button>
                <Button size="sm" type="button" onClick={() => startEdit(r)} disabled={busy}>
                  수정
                </Button>
                <Button size="sm" type="button" onClick={() => toggle(r)} disabled={busy}>
                  {r.isActive ? "비활성화" : "활성화"}
                </Button>
                <Button size="sm" type="button" variant="danger" onClick={() => remove(r)} disabled={busy}>
                  삭제
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing === null && (
        <div className="actions">
          {canEdit && (
            <Button type="button" variant="primary" onClick={startNew}>
              + 담당자 · 공간 추가
            </Button>
          )}
          {mode === "wizard" && (canEdit ? items.some((r) => r.isActive) : true) && (
            <Link href="/console/onboarding/3" className="btn">
              다음 단계
            </Link>
          )}
        </div>
      )}

      {canEdit && editing !== null && (
        <form className="panel" onSubmit={submit}>
          <h2>{editing === "new" ? "새 담당자 · 공간" : "수정"}</h2>
          <Field label="종류" htmlFor="r-type" hint={TYPE_HINT[draft.type]}>
            <select id="r-type" className="select" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as Draft["type"], memberId: "" }))}>
              <option value="STAFF">담당자 (사람)</option>
              <option value="SPACE">공간</option>
              <option value="SHARED">공용 자원</option>
            </select>
          </Field>
          <div className="grid-2">
            <Field label="이름" htmlFor="r-name" error={errors.name}>
              <Input id="r-name" required maxLength={100} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={draft.type === "STAFF" ? "김디자이너" : "A룸"} aria-invalid={!!errors.name} />
            </Field>
            <Field label="정원" htmlFor="r-cap" error={errors.capacity} hint="한 타임에 받을 수 있는 인원. 1:1 응대는 1, 그룹 레슨 강사·다인실은 그 수">
              <Input id="r-cap" type="number" min={1} max={500} required value={draft.capacity} onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))} aria-invalid={!!errors.capacity} />
            </Field>
          </div>
          <Field label="설명 (선택)" htmlFor="r-desc" error={errors.description}>
            <Input id="r-desc" maxLength={1000} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="고객에게 보이는 한 줄 소개" />
          </Field>
          {draft.type === "STAFF" && (
            <Field label="계정 연결 (선택)" htmlFor="r-member" error={errors.memberId} hint="아직 초대하지 않았다면 비워 두세요. 나중에 매니저를 초대할 때 이름이 같으면 자동으로 연결됩니다">
              <select id="r-member" className="select" value={draft.memberId} onChange={(e) => setDraft((d) => ({ ...d, memberId: e.target.value }))}>
                <option value="">연결 안 함</option>
                {linkable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role === "OWNER" ? "사업자 본인" : m.status === "INVITED" ? "초대 대기" : "매니저"})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="actions">
            <Button type="submit" variant="primary" loading={busy}>
              {editing === "new" ? "등록" : "저장"}
            </Button>
            <Button type="button" onClick={() => setEditing(null)} disabled={busy}>
              취소
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
