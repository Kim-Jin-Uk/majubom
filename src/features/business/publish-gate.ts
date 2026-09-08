import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, resources, sitePages } from "@/db/schema";
import { getBusinessSettings, isInfoComplete } from "./settings";

/**
 * 홈페이지 공개 조건 (FR-BIZ-030, #29) 와 온보딩 진행 상태.
 *
 * 공개 URL(/@slug) 이 살아 있으려면 셋이 모두 참이어야 한다:
 *   활성 상품 ≥ 1 · 활성 자원 ≥ 1 · SitePage.isPublished — 그리고 사업장 status = APPROVED (관리자 승인은 공개 URL 게이트).
 * 미충족이면 공개 URL 은 "준비 중" 페이지를 낸다 (공개 홈 에픽 #71 에서 렌더링). 여기서는 판정만.
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

export async function getPublishStatus(businessId: string): Promise<PublishStatus> {
  const b = await getBusinessSettings(businessId);
  const [{ n: activeResources }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(resources)
    .where(and(eq(resources.businessId, businessId), eq(resources.isActive, true)));
  const [{ n: activeProducts }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.status, "ACTIVE")));
  const [page] = await db.select({ isPublished: sitePages.isPublished }).from(sitePages).where(eq(sitePages.businessId, businessId)).limit(1);
  const [biz] = await db.select({ status: businesses.status }).from(businesses).where(eq(businesses.id, businessId)).limit(1);

  const infoComplete = isInfoComplete(b);
  const sitePublished = page?.isPublished ?? false;
  const approved = biz?.status === "APPROVED";
  const readyToPublish = infoComplete && activeResources > 0 && activeProducts > 0;
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return {
    approved,
    businessStatus: b.status,
    infoComplete,
    activeResources,
    activeProducts,
    sitePublished,
    readyToPublish,
    live: approved && readyToPublish && sitePublished,
    publicUrl: `${base.replace(/\/$/, "")}/@${b.slug}`,
  };
}

/** 위저드 단계 상태 — 사이드바·진행률. 단계 번호는 기획서 6.1 순서 */
export type WizardStep = { n: 1 | 2 | 3 | 4 | 5 | 6; key: "info" | "resources" | "product" | "brand" | "policy" | "chat"; label: string; done: boolean; required: boolean; available: boolean };

export function wizardSteps(p: PublishStatus, opts: { chatEnabled: boolean; policyTouched: boolean; brandTouched: boolean }): WizardStep[] {
  return [
    { n: 1, key: "info", label: "매장 정보 · 영업시간", done: p.infoComplete, required: true, available: true },
    { n: 2, key: "resources", label: "담당자 · 공간 등록", done: p.activeResources > 0, required: true, available: true },
    { n: 3, key: "product", label: "첫 예약 상품", done: p.activeProducts > 0, required: true, available: true },
    { n: 4, key: "brand", label: "홈페이지 로고 · 색상", done: opts.brandTouched, required: false, available: true },
    { n: 5, key: "policy", label: "예약 정책", done: opts.policyTouched, required: false, available: true },
    { n: 6, key: "chat", label: "고객 상담 설정", done: false, required: false, available: opts.chatEnabled },
  ];
}
