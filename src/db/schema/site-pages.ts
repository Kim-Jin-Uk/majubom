import { boolean, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps, uuidPk } from "./_common";
import { businesses } from "./businesses";

/**
 * SitePage — 홈페이지 빌더 (FR-SITE-030). 섹션·블록은 별 테이블이 아니라 jsonb 트리다 (02 §2.2).
 * 초안과 발행본을 분리 저장하고, 직전 발행본 1개를 되돌리기용으로 둔다.
 */
export type SiteBlock = {
  id: string;
  type: string;
  layout: {
    desktop: { x: number; y: number; w: number; h: number };
    mobile: { x: number; y: number; w: number; h: number };
  };
  props: Record<string, unknown>;
  style?: Record<string, unknown>;
};

export type SiteSection = {
  id: string;
  order: number;
  background: { type: "NONE" | "COLOR" | "IMAGE"; value?: string; overlay?: string };
  paddingY: number;
  fullWidth: boolean;
  rowHeight: number;
  desktopRows: number;
  mobileRows: number;
  blocks: SiteBlock[];
};

export type SitePageData = { sections: SiteSection[] };

/**
 * 공개 홈의 밝기 (01 §10 "공개 페이지는 사업자가 라이트/다크/자동 중 선택").
 * `AUTO` 는 손님의 OS 설정(prefers-color-scheme)을 따른다.
 */
export type SiteColorScheme = "AUTO" | "LIGHT" | "DARK";

export type SiteTheme = {
  primaryColor: string;
  fontScale: number;
  radius: number;
  containerWidth: number;
  /**
   * 이 키가 생기기 전에 쓰인 행에는 없다 — 그래서 선택이다. 읽는 쪽은 반드시
   * `features/site/theme.ts` 의 `normalizeColorScheme` 을 거쳐 기본값(AUTO)으로 메운다.
   */
  colorScheme?: SiteColorScheme;
};

export const sitePages = pgTable("site_pages", {
  id: uuidPk(),
  /** MVP 는 사업장당 홈 1개 → unique. 다중 페이지는 v2 에서 unique 를 (business_id, path) 로 바꾼다. */
  businessId: uuid("business_id")
    .notNull()
    .unique()
    .references(() => businesses.id),
  draftData: jsonb("draft_data").$type<SitePageData>().notNull(),
  publishedData: jsonb("published_data").$type<SitePageData>(),
  previousPublishedData: jsonb("previous_published_data").$type<SitePageData>(),
  /** 낙관적 잠금. 서버 값과 다르면 409 DRAFT_CONFLICT */
  draftVersion: integer("draft_version").notNull().default(0),
  theme: jsonb("theme").$type<SiteTheme>().notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
});
