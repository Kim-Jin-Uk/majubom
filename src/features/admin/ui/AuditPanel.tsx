"use client";

import { useState } from "react";
import { Alert, Button, Input } from "@/components/ui";
import type { AuditRow } from "@/features/admin/audit";
import { apiGet, describeError } from "@/lib/client-api";

/**
 * 감사 로그 조회 (FR-ADM-040, #68).
 *
 * 이 화면의 쓸모는 **"무슨 일이 있었나" 를 사후에 되짚는 것**이다. 그래서 최신순 고정이고,
 * 목록에서 바로 diff 를 펼쳐 본다 — 상세 페이지로 한 번 더 들어가면 여러 건을 훑는 조사가 느려진다.
 */
const ACTION_TEXT: Record<string, string> = {
  BUSINESS_APPROVE: "가입 승인",
  BUSINESS_REJECT: "가입 반려",
  BUSINESS_SUSPEND: "사업장 정지",
  BUSINESS_BLOCK: "사업장 차단",
  BUSINESS_RESTORE: "사업장 복구",
  BUSINESS_UPDATE: "사업장 정보 변경",
  PLAN_LIMIT_UPDATE: "플랜 한도 변경",
  MEMBER_CREATE: "구성원 초대",
  MEMBER_DEACTIVATE: "구성원 비활성",
  MEMBER_REACTIVATE: "구성원 재활성",
  MEMBER_PERMISSION_UPDATE: "권한 변경",
  PRODUCT_DELETE: "상품 삭제",
  POLICY_UPDATE: "예약 정책 변경",
  SCHEDULE_UPDATE: "근무표 변경",
  SHIFT_APPROVE: "교대 승인",
  SHIFT_DENY: "교대 반려",
  HOLIDAY_BULK_CANCEL: "휴무 일괄 취소",
  LEAVE_APPROVE: "휴가 승인",
  LEAVE_DENY: "휴가 반려",
  RESERVATION_STATUS_CHANGE: "예약 상태 변경",
  RESERVATION_REASSIGN: "예약 담당 변경",
  RESERVATION_CREATE_WALKIN: "워크인 등록",
  SITE_PUBLISH: "홈 발행",
  SITE_REVERT: "홈 되돌리기",
  REPORT_VIEW: "신고 열람",
  REPORT_ACTION: "신고 처리",
  CHAT_BLOCK: "채팅 차단",
  USER_SUSPEND: "사용자 정지",
  LOGIN_FAIL: "로그인 실패",
  PASSWORD_CHANGE: "비밀번호 변경",
};

const ROLE_TEXT: Record<string, string> = { ADMIN: "운영자", OWNER: "사업자", MANAGER: "매니저", CUSTOMER: "고객", SYSTEM: "시스템" };

/** 64자 hex 는 `hashPii` 를 거친 값이다 — 원문이 아니라는 게 보여야 한다 */
const HASH = /^[0-9a-f]{64}$/;
function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return HASH.test(v) ? `해시 ${v.slice(0, 8)}…` : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** `{ from, to }` 꼴이면 변경 전후로, 아니면 값 그대로 */
function DiffView({ diff }: { diff: Record<string, unknown> | null }) {
  if (!diff || Object.keys(diff).length === 0) return <span className="muted">변경 내용 없음</span>;
  return (
    <dl className="audit-diff">
      {Object.entries(diff).map(([k, v]) => {
        const pair = v && typeof v === "object" && !Array.isArray(v) && ("from" in v || "to" in v) ? (v as { from?: unknown; to?: unknown }) : null;
        return (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{pair ? <>{show(pair.from)} <span className="muted">→</span> {show(pair.to)}</> : show(v)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** 서버 컴포넌트에서 넘어오면 `at` 은 Date, API 응답으로 오면 문자열이다 — 둘 다 `new Date()` 가 받는다 */
type Row = Omit<AuditRow, "at"> & { at: string | Date };
/**
 * **타임존을 반드시 박는다.** 생략하면 서버는 UTC, 브라우저는 KST 로 그려 하이드레이션이 깨진다
 * (CI 가 잡았다 — 로컬은 양쪽 다 KST 라 안 보인다). 관리자 화면은 사업장별이 아니라 전역이므로
 * 사업장 타임존이 아니라 운영 기준시(`Asia/Seoul`)다 — 기기 설정이 달라도 운영자끼리 같은 시각을 본다.
 */
function fmtAt(at: string | Date): string {
  return new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
}

type Page = { items: Row[]; nextCursor: string | null; actions: Array<{ action: string; count: number }> };

export function AuditPanel({ initial }: { initial: Page }) {
  const [page, setPage] = useState<Page>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ action: "", business: "", actor: "", from: "", to: "" });

  function query(extra: Record<string, string> = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) sp.set(k, v);
    return sp.toString();
  }

  async function load(extra: Record<string, string> = {}, append = false) {
    setBusy(true);
    const r = await apiGet<Page>(`/api/admin/audit?${query(extra)}`);
    setBusy(false);
    if (!r.ok) {
      setErr(describeError(r));
      return;
    }
    setErr(null);
    setPage((prev) => (append ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data));
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}

      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <select className="select" aria-label="행위" value={f.action} onChange={set("action")}>
          {/* 실제로 쌓인 것만 낸다 — 30종을 늘어놓으면 대부분이 0건이라 "없는 걸 골랐나" 와 구분이 안 된다 */}
          <option value="">모든 행위</option>
          {page.actions.map((a) => (
            <option key={a.action} value={a.action}>
              {ACTION_TEXT[a.action] ?? a.action} ({a.count})
            </option>
          ))}
        </select>
        <Input aria-label="사업장" placeholder="사업장 이름·공개 주소" value={f.business} onChange={set("business")} />
        <Input aria-label="행위자" placeholder="행위자 이름·이메일" value={f.actor} onChange={set("actor")} />
        <Input aria-label="시작일" type="date" value={f.from} onChange={set("from")} />
        <Input aria-label="종료일" type="date" value={f.to} onChange={set("to")} />
        <Button type="submit" variant="primary" loading={busy}>
          조회
        </Button>
      </form>

      {page.items.length === 0 ? (
        <p className="sub">조건에 맞는 기록이 없어요.</p>
      ) : (
        <ul className="audit-list">
          {page.items.map((r) => (
            <li key={r.id} className="audit-row">
              <button type="button" className="audit-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="audit-at">{fmtAt(r.at)}</span>
                <b>{ACTION_TEXT[r.action] ?? r.action}</b>
                <span className="muted">
                  {r.actorName ?? "시스템"}
                  {r.actorRole ? ` · ${ROLE_TEXT[r.actorRole] ?? r.actorRole}` : ""}
                  {r.businessName ? ` · ${r.businessName}` : ""}
                </span>
              </button>
              {open === r.id && (
                <div className="audit-body">
                  <DiffView diff={r.diff} />
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                    {r.targetType ? `${r.targetType} ${r.targetId ?? ""}` : ""}
                    {r.ip ? ` · ${r.ip}` : ""}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <div className="actions actions--center" style={{ marginTop: 12 }}>
          <Button type="button" loading={busy} onClick={() => void load({ cursor: page.nextCursor! }, true)}>
            더 보기
          </Button>
        </div>
      )}
    </>
  );
}
