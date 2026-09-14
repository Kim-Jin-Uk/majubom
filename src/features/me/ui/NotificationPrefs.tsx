"use client";

import { useState } from "react";
import { Alert } from "@/components/ui";
import { isInAppLocked, type Channels, type EventGroup, type PreferenceRow } from "@/features/me/notification-rules";
import { apiPut, describeError } from "@/lib/client-api";

/**
 * 알림 채널 설정 (FR-NOTI-030, #90).
 *
 * **스위치를 누르면 바로 저장한다.** 저장 버튼을 두면 켜 놓고 나가 버린 사용자가 안 바뀐 이유를 모른다.
 * 서버가 고쳐 쓴 값(인앱 잠금)을 응답으로 돌려받아 그대로 반영한다 — 화면이 제 값을 믿으면 어긋난다.
 */
const GROUP_TEXT: Record<EventGroup, { label: string; hint: string }> = {
  RESERVATION: { label: "예약", hint: "확정·거절·취소·리마인더" },
  SCHEDULE: { label: "근무", hint: "근무표·교대 요청과 응답" },
  CHAT: { label: "채팅", hint: "매장과 주고받는 메시지" },
  MARKETING: { label: "혜택·소식", hint: "받겠다고 켜 두신 경우에만 보내요. 밤 9시~아침 8시에는 보내지 않습니다." },
};

const CHANNELS: Array<{ key: keyof Channels; label: string }> = [
  { key: "inApp", label: "앱 안" },
  { key: "push", label: "푸시" },
  { key: "email", label: "메일" },
];

export function NotificationPrefs({ initial, groups }: { initial: PreferenceRow[]; groups: EventGroup[] }) {
  const [rows, setRows] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<EventGroup | null>(null);
  const shown = rows.filter((r) => groups.includes(r.eventGroup));

  async function toggle(row: PreferenceRow, key: keyof Channels) {
    const next = { ...row, [key]: !row[key] };
    setBusy(row.eventGroup);
    const r = await apiPut<{ items: PreferenceRow[] }>("/api/me/notifications", {
      eventGroup: next.eventGroup,
      inApp: next.inApp,
      push: next.push,
      email: next.email,
    });
    setBusy(null);
    if (!r.ok) {
      setErr(describeError(r));
      return;
    }
    setErr(null);
    setRows(r.data.items);
  }

  return (
    <section className="panel">
      <h2>알림</h2>
      <p className="sub">예약처럼 꼭 알아야 하는 소식의 <b>앱 안 알림</b>은 끌 수 없어요. 놓치면 되돌릴 방법이 없는 것들이라서요.</p>
      {err && <Alert kind="error">{err}</Alert>}
      {/* 푸시는 아직 보낼 수단이 없다 — 켜 두면 "켰는데 안 온다" 가 된다. 숨기지 않고 왜인지 말한다 */}
      <Alert kind="info">푸시 알림은 아직 준비 중이에요(웹푸시는 에픽 16). 지금은 앱 안 알림과 메일로 보내 드립니다.</Alert>
      <ul className="pref-list">
        {shown.map((r) => (
          <li key={r.eventGroup}>
            <div className="pref-head">
              <b>{GROUP_TEXT[r.eventGroup].label}</b>
              <span className="sub">{GROUP_TEXT[r.eventGroup].hint}</span>
            </div>
            <div className="pref-switches">
              {CHANNELS.map((c) => {
                const locked = c.key === "inApp" && isInAppLocked(r.eventGroup);
                return (
                  <label key={c.key} className={`pref-switch${locked ? " locked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={r[c.key]}
                      disabled={locked || busy === r.eventGroup}
                      onChange={() => void toggle(r, c.key)}
                      aria-label={`${GROUP_TEXT[r.eventGroup].label} ${c.label}`}
                    />
                    <span>{c.label}</span>
                  </label>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
