"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { SessionListItem } from "@/features/auth/session-store";
import { apiDelete, describeError } from "@/lib/client-api";

type Item = Omit<SessionListItem, "createdAt" | "lastUsedAt" | "expiresAt"> & { createdAt: string; lastUsedAt: string; expiresAt: string };

function fmt(iso: string) {
  // 서버(UTC)·브라우저(KST) 렌더가 어긋나지 않게 타임존을 고정한다 (사업장 기본 timezone 과 동일)
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 기기 관리 — 활성 리프레시 세션 목록·개별/일괄 폐기. 현재 기기를 폐기하면 바로 로그아웃한다 */
export function SessionsPanel({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function revoke(id: string, current: boolean) {
    setBusy(id);
    const r = await apiDelete<{ ok: true; current: boolean }>(`/api/me/sessions/${id}`);
    setBusy(null);
    if (!r.ok) return setMsg(describeError(r));
    if (current) return void signOut({ redirectTo: "/login?reason=REFRESH_REVOKED" });
    setItems((xs) => xs.filter((x) => x.id !== id));
  }

  async function revokeOthers() {
    setBusy("all");
    const r = await apiDelete<{ ok: true; revoked: number }>("/api/me/sessions");
    setBusy(null);
    if (!r.ok) return setMsg(describeError(r));
    setItems((xs) => xs.filter((x) => x.current));
    setMsg(`다른 기기 ${r.data.revoked}개에서 로그아웃했습니다.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {msg && <Alert kind="info">{msg}</Alert>}
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>기기</th>
              <th>IP</th>
              <th>마지막 사용</th>
              <th>로그인</th>
              <th>만료</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.deviceLabel ?? "알 수 없는 기기"} {s.current && <span className="tag">이 기기</span>}
                </td>
                <td className="muted">{s.ip ?? "—"}</td>
                <td className="muted">{fmt(s.lastUsedAt)}</td>
                <td className="muted">{fmt(s.createdAt)}</td>
                <td className="muted">{fmt(s.expiresAt)}</td>
                <td>
                  <Button size="sm" variant={s.current ? "danger" : "default"} type="button" onClick={() => revoke(s.id, s.current)} loading={busy === s.id} disabled={busy !== null}>
                    {s.current ? "로그아웃" : "폐기"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.some((s) => !s.current) && (
        <Button type="button" variant="danger" onClick={revokeOthers} loading={busy === "all"} style={{ alignSelf: "flex-start" }}>
          다른 기기 모두 로그아웃
        </Button>
      )}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        세션은 로그인 후 30일에 만료되며 15분마다 자동 갱신됩니다. 폐기한 기기는 콘솔·관리자·이 화면에서는 즉시, 그 밖의 화면에서는 최대 15분 안에 로그아웃됩니다.
        비밀번호를 바꾸면 모든 기기가 로그아웃됩니다.
      </p>
    </div>
  );
}
