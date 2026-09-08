import Link from "next/link";
import type { PublishStatus, WizardStep } from "@/features/business/publish-gate";

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** 위저드 사이드바 — 6단계 + 공개 조건 패널 (기획서 6.1, 디자인 Onboarding). 단계는 순서 없이 이동할 수 있다 */
export function WizardSide({ steps, current, status }: { steps: WizardStep[]; current: number; status: PublishStatus }) {
  const conds: Array<[string, boolean]> = [
    ["매장 정보", status.infoComplete],
    ["자원 1개 이상", status.activeResources > 0],
    ["상품 1개 이상", status.activeProducts > 0],
  ];
  return (
    <aside className="wizard-side">
      <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 6px" }}>
        <b style={{ fontSize: 16 }}>매장 준비하기</b>
        <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-3)" }}>
          순서대로 하지 않아도 돼요.
          <br />
          1·2·3만 마치면 공개할 수 있어요.
        </span>
      </div>
      <nav className="wiz" aria-label="온보딩 단계">
        {steps.filter((s) => s.available).map((s) => {
          const cls = ["wstep", s.n === current ? "now" : s.done ? "done" : ""].filter(Boolean).join(" ");
          return (
            <Link key={s.n} href={`/console/onboarding/${s.n}`} className={cls} aria-current={s.n === current ? "step" : undefined}>
              <span className="n">{s.done && s.n !== current ? <Check /> : s.n}</span>
              {s.label}
              {(s.comingSoon || !s.required) && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{s.comingSoon && !s.done ? "준비 중" : "선택"}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="pubcond">
        <b>공개 조건</b>
        {conds.map(([label, ok]) => (
          <div key={label} className={ok ? "c ok" : "c"}>
            {ok ? <Check /> : <span className="box" />}
            {label}
          </div>
        ))}
        <span style={{ marginTop: 4, color: "var(--text-3)" }}>
          {status.live ? "홈페이지가 공개 중이에요" : status.readyToPublish ? (status.approved ? "홈페이지 공개 스위치만 남았어요" : "승인되면 바로 공개할 수 있어요") : "셋을 마치면 공개할 수 있어요"}
        </span>
      </div>
    </aside>
  );
}
