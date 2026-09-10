"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import type { SiteColorScheme } from "@/db/schema";
import { apiPut, describeError } from "@/lib/client-api";
import { COLOR_SCHEME_LABELS, SITE_COLOR_SCHEMES } from "../theme";

/**
 * 공개 홈 밝기 선택 (#76 · 01 §10). 위저드 4단계 · 설정 화면 공용.
 *
 * 미리보기를 붙이지 않았다: 콘솔은 콘솔대로 밝기가 있어서, 여기 작은 상자 하나를 어둡게 칠해 봐야
 * 손님이 볼 화면과 닮지 않는다. 대신 저장하면 공개 주소를 바로 열 수 있게 링크를 둔다.
 */
export function SiteThemeForm({ initial, publicUrl, live, readOnly }: { initial: SiteColorScheme; publicUrl: string; live: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<SiteColorScheme>(initial);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await apiPut("/api/console/site-theme", { colorScheme: value });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: describeError(r) });
      return;
    }
    setMsg({ kind: "ok", text: "저장했습니다" });
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>홈페이지 밝기</h2>
      <p className="sub">손님이 보는 예약 페이지의 밝기입니다. 손님이 페이지 위쪽 버튼으로 직접 바꿀 수도 있어요 — 그때는 손님의 선택이 우선합니다.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="radio-cards radio-cards--3" role="radiogroup" aria-label="홈페이지 밝기">
        {SITE_COLOR_SCHEMES.map((s) => (
          <label key={s} className={`radio-card${value === s ? " on" : ""}`}>
            <input type="radio" name="colorScheme" value={s} checked={value === s} disabled={readOnly} onChange={() => setValue(s)} />
            <span>
              <b>{COLOR_SCHEME_LABELS[s].label}</b>
              <span className="hint">{COLOR_SCHEME_LABELS[s].hint}</span>
            </span>
          </label>
        ))}
      </div>
      {!readOnly && (
        <div className="actions">
          <Button type="button" onClick={save} loading={busy} disabled={value === initial} variant="primary">
            저장
          </Button>
          {/* 아직 공개 조건을 못 갖춘 가게에 이 링크를 주면 사장님이 자기 404 를 본다 */}
          {live && (
            <a href={publicUrl} target="_blank" rel="noreferrer" className="btn">
              공개 페이지 열기
            </a>
          )}
        </div>
      )}
    </section>
  );
}
