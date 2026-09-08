import Link from "next/link";
import { Alert } from "@/components/ui";
import { getPolicy, isPolicyTouched } from "@/features/business/policy";
import { getPublishStatus, nextWizardStep, wizardSteps } from "@/features/business/publish-gate";
import { getBusinessSettings } from "@/features/business/settings";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { flags } from "@/lib/flags";

export const metadata = { title: "콘솔 — 마주,봄" };

/**
 * 콘솔 홈. 대시보드(예약 현황)는 #59(8-1). 지금은 공개 조건과 다음 할 일을 보여준다.
 * 접근 제어(로그인·소속·상태·이메일 검증)는 프록시가, 상태 배너는 layout.tsx 가 맡는다.
 */
export default async function ConsoleHome() {
  const v = await consoleViewer("/console");
  const bid = v.membership.businessId;
  const [b, status, policy] = await Promise.all([getBusinessSettings(bid), getPublishStatus(bid), getPolicy(bid)]);
  const steps = wizardSteps(status, { chatEnabled: flags.chat, policyTouched: isPolicyTouched(policy), brandTouched: false });
  const nextStep = nextWizardStep(steps);
  const waitingProduct = !nextStep && steps.some((s) => s.required && !s.done && s.comingSoon);
  return (
    <ConsoleShell current="home" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>{b.name}</h1>
      {status.live ? (
        <Alert kind="ok">
          홈페이지가 공개 중입니다 —{" "}
          <a href={status.publicUrl} target="_blank" rel="noreferrer">
            {status.publicUrl}
          </a>
        </Alert>
      ) : status.readyToPublish ? (
        <Alert kind="info">{status.approved ? "공개 조건을 모두 갖췄어요. 홈페이지 빌더에서 공개 스위치를 켜면 예약을 받기 시작합니다." : "공개 조건을 모두 갖췄어요. 심사가 끝나면 바로 공개할 수 있습니다."}</Alert>
      ) : (
        <Alert kind="warn">
          예약을 받으려면 매장 정보 · 담당자(공간) · 상품이 필요해요.{nextStep ? ` 다음: ${nextStep.label}` : waitingProduct ? " 상품 등록은 다음 배포에서 열려요 — 그때까지 로고·정책을 다듬어 두세요." : ""}
        </Alert>
      )}
      <section className="panel">
        <h2>매장 준비</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {steps
            .filter((s) => s.available)
            .map((s) => (
              <Link key={s.n} href={`/console/onboarding/${s.n}`} className={s.done ? "wstep done" : "wstep"} style={{ border: "1px solid var(--border)" }}>
                <span className="n">{s.n}</span>
                {s.label}
                <span style={{ marginLeft: "auto", fontSize: 11 }}>{s.done ? "완료" : s.comingSoon ? "준비 중" : s.required ? "필수" : "선택"}</span>
              </Link>
            ))}
        </div>
        <div className="actions">
          <Link href={nextStep ? `/console/onboarding/${nextStep.n}` : "/console/onboarding/1"} className="btn btn--primary">
            {nextStep ? "이어서 준비하기" : "준비 내용 보기"}
          </Link>
          <Link href="/console/resources" className="btn">
            담당자 · 공간
          </Link>
          {v.isOwner && (
            <Link href="/console/settings" className="btn">
              설정
            </Link>
          )}
        </div>
      </section>
    </ConsoleShell>
  );
}
