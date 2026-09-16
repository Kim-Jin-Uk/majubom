import { z } from "zod";
import type { ReservationStatus } from "@/features/booking/slot-types";

/**
 * 리뷰의 규칙 (FR-REV-010). **순수 모듈이다** — DB 도 시계도 모른다(`now` 를 받는다).
 *
 * 화면과 서버가 같은 답을 내야 하는 곳이라 규칙을 여기 하나로 둔다. 예약 상세가 "리뷰 쓰기" 를 언제 보여 줄지,
 * 서버가 요청을 언제 받을지가 갈라지면 버튼은 있는데 눌러야 403 이거나, 쓸 수 있는 사람이 쓸 자리를 못 찾는다.
 */
export const REVIEW_WINDOW_DAYS = 30;
export const EDIT_WINDOW_DAYS = 7;

/**
 * **사진은 받지 않는다** (FR-REV-010 의 "최대 3장" 은 아직 미구현). 컬럼은 비워 둔 채로 있다.
 *
 * 스키마에서 통째로 뺀 이유: 올리는 길이 없는데 URL 만 받아 주면 **아무 외부 주소나 저장된다**.
 * 지금은 그리는 곳이 없어 조용하지만, 나중에 사진을 붙이는 날 그 값들이 공개 페이지에서 그려져
 * 남의 서버가 우리 손님의 접속을 보게 된다. 받는 자리를 만들 때 함께 연다 (리뷰 지적).
 */
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1, "별점을 골라 주세요").max(5),
  content: z.string().trim().min(10, "10자 이상 적어 주세요").max(500, "500자 이내로 적어 주세요"),
});
export type ReviewInput = z.output<typeof reviewInputSchema>;

/** 사업자 답글 (FR-REV-020). 리뷰당 1건, 수정 가능 */
export const replyInputSchema = z.object({
  content: z.string().trim().min(1, "답글을 입력해 주세요").max(500, "500자 이내로 적어 주세요"),
});
export type ReplyInput = z.infer<typeof replyInputSchema>;

/** 리뷰 자격 판정에 필요한 예약의 모습 (DB 행의 투영) */
export type ReviewSubject = {
  status: ReservationStatus;
  /** 방문일 기준 — 기한은 **끝난 시각**부터 센다 */
  endAt: Date;
  createdVia: "WEB" | "CHAT" | "WALK_IN";
  /** 이미 쓴 리뷰가 있으면 그 상태. 없으면 null */
  reviewStatus: "PUBLISHED" | "HIDDEN" | "REPORTED" | "DELETED" | null;
};

export type Eligibility =
  | { can: true; deadline: Date }
  /** 못 쓰는 이유. 화면은 이 값으로 **다른 문장**을 낸다 — "안 됩니다" 하나로는 손님이 뭘 해야 할지 모른다 */
  | { can: false; reason: "NOT_COMPLETED" | "WALK_IN" | "WINDOW_PASSED" | "ALREADY_WRITTEN"; deadline: Date | null };

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function reviewDeadline(endAt: Date): Date {
  return addDays(endAt, REVIEW_WINDOW_DAYS);
}

/**
 * 이 예약에 지금 리뷰를 쓸 수 있는가.
 *
 * **워크인을 막는 이유**(명세가 굳이 적어 둔 것): 워크인은 사업장 내부 계정이 대신 만든 예약이라,
 * 열어 두면 사장님이 자기 가게에 별 다섯을 찍는 경로가 된다.
 *
 * **지운 리뷰가 있어도 다시 못 쓴다.** `reservation_id` 가 unique 라 DB 가 어차피 막지만,
 * 그보다 "지우고 다시 쓰기" 로 평점을 갈아 치우는 길을 열지 않기 위해서다 — 수정은 7일 1회로 따로 있다.
 */
export function reviewEligibility(r: ReviewSubject, now: Date): Eligibility {
  if (r.reviewStatus !== null) return { can: false, reason: "ALREADY_WRITTEN", deadline: null };
  if (r.createdVia === "WALK_IN") return { can: false, reason: "WALK_IN", deadline: null };
  if (r.status !== "COMPLETED") return { can: false, reason: "NOT_COMPLETED", deadline: null };
  const deadline = reviewDeadline(r.endAt);
  if (now.getTime() >= deadline.getTime()) return { can: false, reason: "WINDOW_PASSED", deadline };
  return { can: true, deadline };
}

/**
 * 수정 가능 여부 — **작성 후 7일 이내 1회** (FR-REV-010).
 *
 * "1회" 는 별도 칼럼 없이 `updatedAt > createdAt` 으로 판정한다. 리뷰 행을 건드리는 다른 경로가
 * 상태 변경(신고·숨김·삭제)뿐인데, 그 경우는 어차피 본인이 더 고칠 수 있는 상태가 아니다.
 */
export type EditState = { can: boolean; reason: "EDITED" | "WINDOW_PASSED" | "NOT_PUBLISHED" | null; deadline: Date };

export function reviewEditState(r: { createdAt: Date; updatedAt: Date; status: string }, now: Date): EditState {
  const deadline = addDays(r.createdAt, EDIT_WINDOW_DAYS);
  if (r.status !== "PUBLISHED") return { can: false, reason: "NOT_PUBLISHED", deadline };
  if (r.updatedAt.getTime() > r.createdAt.getTime()) return { can: false, reason: "EDITED", deadline };
  if (now.getTime() >= deadline.getTime()) return { can: false, reason: "WINDOW_PASSED", deadline };
  return { can: true, reason: null, deadline };
}

/** 별점 분포 — 5점부터 1점까지. 없는 점수도 0 으로 남긴다(빼면 막대 그래프가 칸을 건너뛴다) */
export function ratingHistogram(rows: Array<{ rating: number; count: number }>): Array<{ rating: number; count: number }> {
  const by = new Map(rows.map((r) => [r.rating, r.count]));
  return [5, 4, 3, 2, 1].map((rating) => ({ rating, count: by.get(rating) ?? 0 }));
}
