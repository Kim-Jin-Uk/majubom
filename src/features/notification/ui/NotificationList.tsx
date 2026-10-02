"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { InboxItem } from "@/features/notification/inbox";
import { apiGet, apiPatch, describeError } from "@/lib/client-api";

type Row = Omit<InboxItem, "at"> & { at: string };

const fmt = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  // 최근 것은 상대 시각이 읽기 쉽다 — "3분 전" 이 "오후 2:41" 보다 빠르게 판단된다
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}시간 전`;
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
};

/**
 * 알림함 (FR-NOTI-030, #98).
 *
 * **항목을 누르면 읽음 처리하고 딥링크로 간다.** 읽음만 따로 누르게 하면 아무도 안 누르고,
 * 배지 숫자가 영원히 줄지 않는다.
 */
export function NotificationList({ initial, hasMore: initialHasMore }: { initial: Row[]; hasMore: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open(r: Row) {
    // 낙관적으로 먼저 지운다 — 링크로 떠날 화면이라 서버 답을 기다릴 이유가 없다
    if (!r.read) {
      setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, read: true } : x)));
      void apiPatch(`/api/me/notifications/${r.id}/read`, {});
    }
    router.push(r.linkUrl);
  }

  async function readAll() {
    setBusy(true);
    const res = await apiPatch("/api/me/notifications/read-all", {});
    setBusy(false);
    if (!res.ok) return setErr(describeError(res));
    setErr(null);
    setRows((xs) => xs.map((x) => ({ ...x, read: true })));
    router.refresh();
  }

  async function more() {
    setBusy(true);
    const res = await apiGet<{ items: Row[]; hasMore: boolean }>(`/api/me/notifications?offset=${rows.length}`);
    setBusy(false);
    if (!res.ok) return setErr(describeError(res));
    setErr(null);
    setRows((xs) => [...xs, ...res.data.items]);
    setHasMore(res.data.hasMore);
  }

  const unread = rows.filter((r) => !r.read).length;

  if (rows.length === 0) return <p className="sub">아직 알림이 없어요.</p>;

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}
      {unread > 0 && (
        <div className="actions" style={{ marginBottom: 10 }}>
          <Button type="button" size="sm" loading={busy} onClick={() => void readAll()}>
            모두 읽음 ({unread})
          </Button>
        </div>
      )}
      <ul className="noti-list">
        {rows.map((r) => (
          <li key={r.id}>
            {/* 버튼이다 — 링크로 두면 읽음 처리가 새 탭·가운데 클릭에서 빠진다 */}
            <button type="button" className={`noti${r.read ? "" : " unread"}`} onClick={() => void open(r)}>
              <span className="noti__head">
                <b>{r.label}</b>
                {r.businessName && <span className="sub">{r.businessName}</span>}
                <span className="sub noti__at">{fmt(r.at)}</span>
              </span>
              <span className="noti__body">{r.body}</span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="actions actions--center" style={{ marginTop: 12 }}>
          <Button type="button" loading={busy} onClick={() => void more()}>
            더 보기
          </Button>
        </div>
      )}
      {/* 30일이 지나면 저절로 사라진다는 걸 말해 준다 — 없어졌다고 놀라지 않게 */}
      <p className="sub" style={{ marginTop: 14 }}>알림은 30일이 지나면 자동으로 정리돼요.</p>
    </>
  );
}
