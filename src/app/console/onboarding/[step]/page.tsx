import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
import { listMembers } from "@/features/auth/members";
import { isPolicyTouched } from "@/features/business/policy";
import { loadConsoleBusiness, wizardSteps } from "@/features/business/publish-gate";
import { listResources } from "@/features/business/resources";
import { BusinessInfoForm } from "@/features/business/ui/BusinessInfoForm";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { PolicyForm } from "@/features/business/ui/PolicyForm";
import { ResourcesPanel } from "@/features/business/ui/ResourcesPanel";
import { WizardSide } from "@/features/business/ui/WizardSide";
import { listProducts } from "@/features/product/products";
import { ProductForm } from "@/features/product/ui/ProductForm";
import { ProductsPanel } from "@/features/product/ui/ProductsPanel";
import { consoleViewer, publicBase } from "@/features/business/ui/console-viewer";
import { SiteThemeForm } from "@/features/site/ui/SiteThemeForm";
import { flags } from "@/lib/flags";


const TITLES: Record<number, [string, string]> = {
  1: ["매장 정보와 영업시간을 알려주세요", "예약 페이지 상단과 예약 가능 시간의 기준이 됩니다. 언제든 설정에서 바꿀 수 있어요."],
  2: ["누가, 어디서 예약을 받나요?", "예약이 점유하는 것을 등록합니다 — 담당자(사람), 공간, 공용 장비. 하나만 있어도 시작할 수 있어요."],
  3: ["첫 예약 상품", "고객이 실제로 고르는 메뉴입니다. 담당자형·공간형·수업형 중에서 고르면 값이 알맞게 채워져요."],
  4: ["홈페이지 디자인", "손님이 보는 예약 페이지의 첫인상입니다. 지금은 밝기를 고를 수 있어요 — 건너뛰어도 기본 디자인으로 공개됩니다."],
  5: ["예약 정책", "자동 확정, 취소 마감, 선행 시간 같은 운영 규칙입니다. 기본값도 대부분의 매장에 잘 맞아요."],
  6: ["고객 상담 설정", "예약 페이지에서 고객이 바로 말을 걸 수 있는 채팅 창구입니다."],
};

export async function generateMetadata({ params }: { params: Promise<{ step: string }> }) {
  const n = Number((await params).step);
  return { title: `${TITLES[n]?.[0] ?? "매장 준비하기"} — 마주,봄 콘솔` };
}

/** 온보딩 위저드 (FR-BIZ-010~030, #25). 단계는 URL 로, 완료 여부는 실제 데이터로 판정 — 별도 진행 상태를 저장하지 않는다 */
export default async function OnboardingStep({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1 || n > 6) notFound();
  const v = await consoleViewer(`/console/onboarding/${n}`);
  const bid = v.membership.businessId;
  const { settings: b, policy, status, colorScheme } = await loadConsoleBusiness(bid);
  const steps = wizardSteps(status, { chatEnabled: flags.chat, policyTouched: isPolicyTouched(policy), brandTouched: colorScheme !== "AUTO" });
  if (!steps[n - 1].available) notFound();
  const done = steps.filter((s) => s.done && s.available).length;
  const total = steps.filter((s) => s.available).length;
  const [title, lead] = TITLES[n];

  const next = (
    <div className="actions">
      {n < 6 && steps[n].available && (
        <Link href={`/console/onboarding/${n + 1}`} className="btn btn--primary">
          다음 단계
        </Link>
      )}
      <Link href="/console" className="btn">
        콘솔 홈
      </Link>
    </div>
  );

  let body: React.ReactNode;
  if (n === 1) {
    body = <BusinessInfoForm initial={b} mode="wizard" readOnly={!v.isOwner || v.readOnly} publicBase={publicBase()} />;
  } else if (n === 2) {
    const [resources, members] = await Promise.all([listResources(bid), listMembers(bid)]);
    body = (
      <>
        <ResourcesPanel initial={resources} members={members} isOwner={v.isOwner} readOnly={v.readOnly} mode="wizard" />
        <p className="sub" style={{ margin: 0, fontSize: 13, color: "var(--text-3)" }}>
          담당자에게 콘솔 계정을 주려면 <Link href="/console/resources">담당자 · 공간</Link> 화면에서 매니저로 초대하세요. 이름이 같으면 자동으로 연결됩니다.
        </p>
      </>
    );
  } else if (n === 3) {
    const [resources, list] = await Promise.all([listResources(bid), listProducts(bid)]);
    body =
      list.length > 0 ? (
        <>
          <ProductsPanel initial={list} isOwner={v.isOwner} readOnly={v.readOnly} canEdit={(v.isOwner || Boolean(v.membership.permissions.editProduct)) && !v.readOnly} />
          <div className="actions">
            <Link href="/console/onboarding/4" className="btn">
              다음 단계
            </Link>
          </div>
        </>
      ) : (
        <ProductForm businessId={bid} resources={resources} initial={null} mode="wizard" limited={false} readOnly={!v.isOwner || v.readOnly} />
      );
  } else if (n === 4) {
    // 밝기(#76)는 지금 고를 수 있다. 로고·색상은 빌더(에픽 #15)와 함께 열린다
    body = (
      <>
        <SiteThemeForm initial={colorScheme} publicUrl={status.publicUrl} live={status.live} readOnly={!v.isOwner || v.readOnly} />
        <Alert kind="info">로고와 브랜드 색은 홈페이지 빌더와 함께 열립니다. 그때까지는 기본 디자인으로 공개됩니다.</Alert>
        {next}
      </>
    );
  } else if (n === 5) {
    body = <PolicyForm initial={policy} mode="wizard" readOnly={!v.isOwner || v.readOnly} />;
  } else {
    body = (
      <>
        <Alert kind="info">고객 상담(채팅)은 곧 열립니다.</Alert>
        {next}
      </>
    );
  }

  return (
    <ConsoleShell current="onboarding" viewer={{ name: v.name, role: v.membership.role }} wide>
      <div className="wizard">
        <WizardSide steps={steps} current={n} status={status} />
        <main className="wizard-main">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                {n}/{total} 단계 · {done}개 완료
              </span>
              <div className="progress" style={{ flex: 1, maxWidth: 240 }} role="progressbar" aria-label="매장 준비 진행률" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
                <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
              </div>
              <Link href="/console" className="muted" style={{ marginLeft: "auto", fontSize: 13, whiteSpace: "nowrap" }}>
                나중에 하기
              </Link>
            </div>
            <h1>{title}</h1>
            <p className="lead">{lead}</p>
          </div>
          {!v.isOwner && !steps[n - 1].comingSoon && <Alert kind="warn">{n === 2 ? "담당자·공간 등록은 사업자 계정만 할 수 있어요. 목록은 볼 수 있습니다." : n === 4 ? "홈페이지 디자인은 사업자 계정만 바꿀 수 있어요. 지금 설정은 볼 수 있습니다." : "매장 정보와 정책은 사업자 계정만 바꿀 수 있어요. 내용은 볼 수 있습니다."}</Alert>}
          {body}
        </main>
      </div>
    </ConsoleShell>
  );
}
