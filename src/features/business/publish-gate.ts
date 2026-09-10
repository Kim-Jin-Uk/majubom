import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, type BusinessPolicy, type SiteColorScheme } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { normalizeColorScheme } from "@/features/site/theme";
import { mergePolicy } from "./policy";
import { isInfoComplete, type BusinessSettings } from "./settings";

/**
 * 홈페이지 공개 조건 (FR-BIZ-030, #29) 와 온보딩 진행 상태.
 *
 * 공개 URL(/@slug) 이 살아 있으려면 셋이 모두 참이어야 한다:
 *   활성 상품 ≥ 1 · 활성 자원 ≥ 1 · SitePage.isPublished — 그리고 사업장 status = APPROVED (관리자 승인은 공개 URL 게이트).
 * 미충족이면 공개 URL 은 **404** 다 — 상태를 구별할 수 있으면 slug 를 훑어 사업장 목록을 만들 수 있다 (features/site/README.md). 여기서는 판정만.
 *
 * 위저드 단계(기획서 6.1)와의 대응: 1 매장 정보 · 2 자원 · 3 상품 이 공개 조건, 4 로고·색상 · 5 정책 · 6 상담은 선택.
 */
export type PublishStatus = {
  approved: boolean;
  businessStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" | "BLOCKED";
  infoComplete: boolean;
  activeResources: number;
  activeProducts: number;
  sitePublished: boolean;
  /** 셋(정보·자원·상품) 충족 — 승인만 남은 상태 */
  readyToPublish: boolean;
  /** 실제 공개 중 (조건 + 승인 + isPublished) */
  live: boolean;
  publicUrl: string;
};

/** 콘솔 화면이 한 번에 필요로 하는 것 — 설정·정책·공개 조건을 businesses 한 행 + 스칼라 서브쿼리로 읽는다 (왕복 1회) */
export type ConsoleBusiness = { settings: BusinessSettings; policy: BusinessPolicy; status: PublishStatus; colorScheme: SiteColorScheme };

export async function loadConsoleBusiness(businessId: string): Promise<ConsoleBusiness> {
  const [row] = await db
    .select({
      id: businesses.id,
      slug: businesses.slug,
      name: businesses.name,
      bizRegNo: businesses.bizRegNo,
      category: businesses.category,
      phone: businesses.phone,
      address: businesses.address,
      addressDetail: businesses.addressDetail,
      description: businesses.description,
      timezone: businesses.timezone,
      openingHours: businesses.openingHours,
      status: businesses.status,
      rejectedReason: businesses.rejectedReason,
      policy: businesses.policy,
      // 주의: 단일 테이블 select 에서 drizzle 은 ${businesses.id} 를 "id" 로만 렌더링해 서브쿼리 안에서 r.id 로 잡힌다 — 테이블명을 글자로 쓴다
      activeResources: sql<number>`(select count(*)::int from resources r where r.business_id = businesses.id and r.is_active)`,
      activeProducts: sql<number>`(select count(*)::int from products p where p.business_id = businesses.id and p.status = 'ACTIVE')`,
      // 행이 없으면 **공개**다 — 승인된 사업장에는 업종별 시작 템플릿이 적용돼 "빌더를 한 번도 열지 않아도
      // 즉시 예약을 받을 수 있다"(기획서). 기본값을 false 로 두면 빌더(에픽 #15)가 오기 전까지 아무도 공개될 수 없다
      sitePublished: sql<boolean>`coalesce((select sp.is_published from site_pages sp where sp.business_id = businesses.id limit 1), true)`,
      // 위저드 4단계(브랜드)의 완료 판정과 밝기 폼의 초기값 — 같은 한 행에서 가져간다 (왕복을 늘리지 않는다)
      colorScheme: sql<string | null>`(select sp.theme->>'colorScheme' from site_pages sp where sp.business_id = businesses.id limit 1)`,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!row) throw new HttpError(404, "NOT_FOUND");
  const { policy, activeResources, activeProducts, sitePublished, colorScheme, ...settings } = row;
  const infoComplete = isInfoComplete(settings);
  const approved = settings.status === "APPROVED";
  const readyToPublish = infoComplete && activeResources > 0 && activeProducts > 0;
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    settings,
    colorScheme: normalizeColorScheme(colorScheme),
    policy: mergePolicy(policy),
    status: {
      approved,
      businessStatus: settings.status,
      infoComplete,
      activeResources,
      activeProducts,
      sitePublished,
      readyToPublish,
      live: approved && readyToPublish && sitePublished,
      publicUrl: `${base}/@${settings.slug}`,
    },
  };
}

export async function getPublishStatus(businessId: string): Promise<PublishStatus> {
  return (await loadConsoleBusiness(businessId)).status;
}

/** 위저드 단계 상태 — 사이드바·진행률. 단계 번호는 기획서 6.1 순서 */
/** comingSoon: 화면은 있지만 실제 입력은 다음 에픽 — "다음 할 일" 추천에서 건너뛴다 */
export type WizardStep = { n: 1 | 2 | 3 | 4 | 5 | 6; key: "info" | "resources" | "product" | "brand" | "policy" | "chat"; label: string; done: boolean; required: boolean; available: boolean; comingSoon?: boolean };

export function wizardSteps(p: PublishStatus, opts: { chatEnabled: boolean; policyTouched: boolean; brandTouched: boolean }): WizardStep[] {
  return [
    { n: 1, key: "info", label: "매장 정보 · 영업시간", done: p.infoComplete, required: true, available: true },
    { n: 2, key: "resources", label: "담당자 · 공간 등록", done: p.activeResources > 0, required: true, available: true },
    { n: 3, key: "product", label: "첫 예약 상품", done: p.activeProducts > 0, required: true, available: true },
    // 밝기(#76)는 실제로 고를 수 있다 — 로고·브랜드 색만 빌더(에픽 #15)를 기다린다. 그래서 "준비 중" 이 아니다
    { n: 4, key: "brand", label: "홈페이지 디자인", done: opts.brandTouched, required: false, available: true },
    { n: 5, key: "policy", label: "예약 정책", done: opts.policyTouched, required: false, available: true },
    { n: 6, key: "chat", label: "고객 상담 설정", done: false, required: false, available: opts.chatEnabled, comingSoon: true },
  ];
}

/** 다음에 할 단계 — 아직 안 끝난 필수 단계 중 실제로 할 수 있는 것. 없으면 null (남은 필수가 전부 "준비 중" 이거나 다 끝났다) */
export function nextWizardStep(steps: WizardStep[]): WizardStep | null {
  return steps.find((s) => s.required && !s.done && s.available && !s.comingSoon) ?? null;
}
