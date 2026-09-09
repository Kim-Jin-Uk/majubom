"use client";

import { useEffect, type ReactNode } from "react";
/**
 * 토스트 — 화면 아래 가운데에 잠깐 떠서 결과를 알린다. 폼이 화면 아래쪽에 있을 때 위쪽 Alert 는 안 보이므로 결과·오류는 이걸로.
 * 오류는 role=alert(즉시 읽음), 나머지는 status. 6초 뒤(오류는 8초) 스스로 닫히고, 닫기 버튼도 있다.
 */
export function Toast({ kind = "info", children, onClose }: { kind?: "error" | "ok" | "warn" | "info"; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, kind === "error" ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [kind, children, onClose]);
  return (
    <div className={`toast toast--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div className="toast-body">{children}</div>
      <button type="button" className="toast-x" aria-label="닫기" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
