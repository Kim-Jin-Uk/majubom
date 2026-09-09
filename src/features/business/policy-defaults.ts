import type { BusinessPolicy } from "@/db/schema";

/** FR-BIZ-020 예약 정책 기본값. 정책 변경은 미래 예약에만 적용된다 (Reservation 이 cancelDeadlineHours 를 스냅샷). */
export const DEFAULT_POLICY: BusinessPolicy = {
  autoConfirm: true,
  minLeadTimeMin: 60,
  maxAdvanceDays: 30,
  cancelDeadlineHours: 24,
  maxActivePerCustomer: 3,
  autoNoShowAfterHours: 24,
  requestExpireHours: 24,
  reviewEnabled: true,
  shiftAutoApprove: false,
};

/** 업종 코드 (FR-AUTH-010 입력 "업종"). 시작 템플릿(FR-ADM-010) 키와 같다. */
export const BUSINESS_CATEGORIES = [
  ["hair", "미용실 · 헤어"],
  ["nail", "네일 · 왁싱"],
  ["skin", "피부 · 에스테틱"],
  ["massage", "마사지 · 스파"],
  ["studio", "스튜디오 · 공간 대여"],
  ["lesson", "레슨 · 클래스"],
  ["fitness", "피트니스 · PT"],
  ["pet", "반려동물 미용"],
  ["clinic", "상담 · 클리닉"],
  ["etc", "기타"],
] as const;

export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number][0];

/**
 * 업종 코드 → 사람이 읽는 이름. DB 에는 `nail` 같은 코드가 들어 있고 화면·메타태그·검색 결과에는 그대로 나가면 안 된다.
 * 모르는 코드(목록이 바뀌기 전에 저장된 값)는 "기타" 로 — 코드값이 손님에게 보이는 것보다 낫다.
 */
export function categoryLabel(code: string): string {
  return BUSINESS_CATEGORIES.find(([c]) => c === code)?.[1] ?? "기타";
}
export const BUSINESS_CATEGORY_CODES = BUSINESS_CATEGORIES.map(([c]) => c) as unknown as [BusinessCategory, ...BusinessCategory[]];

/** 가입 시 임시 slug — 온보딩(FR-BIZ-010)에서 바꾼다. `b-` + 8자 [a-z0-9] */
export function temporarySlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "b-";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
