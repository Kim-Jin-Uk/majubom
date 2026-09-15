import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, products, reservations, reviewReplies, reviews, users } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import { maskName } from "@/features/site/public-home";
import { EDIT_WINDOW_DAYS, ratingHistogram, reviewEditState, reviewEligibility, type ReplyInput, type ReviewInput } from "./rules";

/**
 * 리뷰 읽기·쓰기 (FR-REV-010 · FR-REV-020). 규칙은 `rules.ts` 에 있다.
 *
 * **공개되는 것은 `PUBLISHED` 뿐이다.** 신고(`REPORTED`)·관리자 숨김(`HIDDEN`)·본인 삭제(`DELETED`) 는
 * 전부 목록·평균·분포에서 빠진다 — 상태 하나로 가르므로 조건을 빠뜨릴 자리가 없다.
 */
export const PUBLIC_REVIEW_PAGE = 20;

/** 예약 상세가 "리뷰 쓰기" 를 보여 줄지 판단할 재료. 자격 판정 자체는 순수 규칙이 한다 */
export async function reviewStateFor(customerId: string, reservationId: string, now = new Date()) {
  const [r] = await db
    .select({
      status: reservations.status,
      endAt: reservations.endAt,
      createdVia: reservations.createdVia,
      reviewId: reviews.id,
      reviewStatus: reviews.status,
    })
    .from(reservations)
    .leftJoin(reviews, eq(reviews.reservationId, reservations.id))
    .where(and(eq(reservations.id, reservationId), eq(reservations.customerId, customerId)))
    .limit(1);
  if (!r) return null;
  return {
    reviewId: r.reviewStatus === "DELETED" ? null : r.reviewId,
    eligibility: reviewEligibility({ status: r.status, endAt: r.endAt, createdVia: r.createdVia, reviewStatus: r.reviewStatus }, now),
  };
}

export async function createReview(customerId: string, reservationId: string, input: ReviewInput, now = new Date()): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // **예약 행을 잠근다.** 같은 예약으로 두 번 눌리면 둘 다 자격 검사를 통과한 뒤 하나가 unique 위반으로
    // 500 이 된다. 잠그면 뒤엣것이 `ALREADY_WRITTEN` 이라는 제 문구를 받는다
    const [r] = await tx
      .select({
        businessId: reservations.businessId,
        productId: reservations.productId,
        status: reservations.status,
        endAt: reservations.endAt,
        createdVia: reservations.createdVia,
      })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.customerId, customerId)))
      .limit(1)
      .for("update");
    // 남의 예약은 존재를 알리지 않는다
    if (!r) throw new HttpError(404, "NOT_FOUND");

    const [existing] = await tx.select({ status: reviews.status }).from(reviews).where(eq(reviews.reservationId, reservationId)).limit(1);
    const e = reviewEligibility({ status: r.status, endAt: r.endAt, createdVia: r.createdVia, reviewStatus: existing?.status ?? null }, now);
    if (!e.can) throw new HttpError(409, e.reason);

    const [row] = await tx
      .insert(reviews)
      .values({ businessId: r.businessId, productId: r.productId, reservationId, customerId, rating: input.rating, content: input.content, images: input.images })
      .returning({ id: reviews.id });
    return { id: row.id };
  });
}

/**
 * 수정 — **조건부 UPDATE 다** (`deleteReview` 와 같은 꼴).
 *
 * 읽고 판정한 뒤 쓰면, 같은 순간에 들어온 두 요청이 **둘 다** 자격 검사를 통과해 "7일 이내 1회" 가 우회된다
 * (리뷰 지적). "아직 한 번도 고치지 않았다" 를 WHERE 에 넣어 DB 가 한 번만 성립시키게 한다 —
 * `updated_at`/`created_at` 비교가 그 판정이고, `updated_at` 은 드리즐이 갱신한다(`$onUpdate`).
 *
 * 0행이면 **그때 읽어서** 왜 안 됐는지 말해 준다. 문구가 하나면 손님이 뭘 해야 할지 모른다 —
 * 이미 고쳤는지, 7일이 지났는지, 신고되어 내려간 글인지는 서로 다른 이야기다.
 */
export async function updateReview(customerId: string, reviewId: string, input: ReviewInput, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - EDIT_WINDOW_DAYS * 86_400_000);
  const done = await db
    .update(reviews)
    .set({ rating: input.rating, content: input.content, images: input.images })
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.customerId, customerId),
        eq(reviews.status, "PUBLISHED"),
        sql`${reviews.updatedAt} = ${reviews.createdAt}`,
        gt(reviews.createdAt, since),
      ),
    )
    .returning({ id: reviews.id });
  if (done.length > 0) return;

  const [r] = await db
    .select({ createdAt: reviews.createdAt, updatedAt: reviews.updatedAt, status: reviews.status })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.customerId, customerId)))
    .limit(1);
  // 남의 리뷰든 없는 리뷰든 같은 404 다
  if (!r) throw new HttpError(404, "NOT_FOUND");
  // 경합에서 밀린 쪽도 여기로 온다 — 다시 읽으면 상대가 고친 뒤라 `EDITED` 라는 정직한 답이 나온다
  throw new HttpError(409, reviewEditState(r, now).reason ?? "EDITED");
}

/**
 * 본인 삭제 (soft). **행을 지우지 않는다** — `reservation_id` unique 가 "예약 1건당 리뷰 1건" 을 지키고 있고,
 * 지우면 같은 예약으로 다시 쓸 수 있게 되어 평점을 갈아 치우는 길이 열린다.
 * 사업자 답글도 같이 가려진다(답글은 리뷰를 통해서만 읽힌다).
 */
export async function deleteReview(customerId: string, reviewId: string): Promise<void> {
  const r = await db
    .update(reviews)
    .set({ status: "DELETED" })
    .where(and(eq(reviews.id, reviewId), eq(reviews.customerId, customerId), eq(reviews.status, "PUBLISHED")))
    .returning({ id: reviews.id });
  if (r.length === 0) throw new HttpError(404, "NOT_FOUND");
}

export type PublicReview = {
  id: string;
  rating: number;
  content: string;
  images: string[];
  author: string;
  at: Date;
  productName: string;
  reply: { content: string; at: Date } | null;
};

export type PublicReviewPage = {
  items: PublicReview[];
  total: number;
  average: number | null;
  histogram: Array<{ rating: number; count: number }>;
  hasMore: boolean;
};

/**
 * 공개 리뷰 목록 (FR-REV-020). 최신순 고정 + 별점 필터.
 *
 * **평균·분포는 필터를 타지 않는다.** 3점만 골라 본 손님에게 "평균 3.0" 을 보여 주면 가게의 평점을 잘못 읽는다 —
 * 요약은 언제나 전체 기준이고, 필터는 목록만 좁힌다.
 */
export async function loadPublicReviews(
  businessId: string,
  opts: { rating?: number; offset?: number } = {},
): Promise<PublicReviewPage> {
  const where = and(eq(reviews.businessId, businessId), eq(reviews.status, "PUBLISHED"));
  const offset = Math.max(0, opts.offset ?? 0);

  const [dist, rows] = await Promise.all([
    db.select({ rating: reviews.rating, count: sql<number>`count(*)::int` }).from(reviews).where(where).groupBy(reviews.rating),
    db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        content: reviews.content,
        images: reviews.images,
        at: reviews.createdAt,
        author: users.name,
        productName: products.name,
        replyContent: reviewReplies.content,
        replyAt: reviewReplies.createdAt,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.customerId))
      .innerJoin(products, eq(products.id, reviews.productId))
      .leftJoin(reviewReplies, eq(reviewReplies.reviewId, reviews.id))
      .where(opts.rating ? and(where, eq(reviews.rating, opts.rating)) : where)
      .orderBy(desc(reviews.createdAt))
      .limit(PUBLIC_REVIEW_PAGE + 1)
      .offset(offset),
  ]);

  const total = dist.reduce((a, b) => a + b.count, 0);
  const sum = dist.reduce((a, b) => a + b.rating * b.count, 0);
  const page = rows.slice(0, PUBLIC_REVIEW_PAGE);

  return {
    items: page.map((r) => ({
      id: r.id,
      rating: r.rating,
      content: r.content,
      images: r.images,
      // 사업자는 `reservationId` 로 작성자를 특정할 수 있다. 공개 화면에서까지 실명을 드러내면
      // 저평점 고객에 대한 보복 여지가 커진다 (FR-REV-020)
      author: maskName(r.author),
      at: r.at,
      productName: r.productName,
      reply: r.replyContent ? { content: r.replyContent, at: r.replyAt! } : null,
    })),
    total,
    average: total > 0 ? sum / total : null,
    histogram: ratingHistogram(dist),
    hasMore: rows.length > PUBLIC_REVIEW_PAGE,
  };
}

/** 콘솔의 리뷰 목록 — 답글을 달러 온다. 작성자는 여기서도 마스킹한다 */
export async function loadBusinessReviews(businessId: string): Promise<PublicReview[]> {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      content: reviews.content,
      images: reviews.images,
      at: reviews.createdAt,
      author: users.name,
      productName: products.name,
      replyContent: reviewReplies.content,
      replyAt: reviewReplies.createdAt,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .innerJoin(products, eq(products.id, reviews.productId))
    .leftJoin(reviewReplies, eq(reviewReplies.reviewId, reviews.id))
    .where(and(eq(reviews.businessId, businessId), eq(reviews.status, "PUBLISHED")))
    .orderBy(desc(reviews.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    images: r.images,
    author: maskName(r.author),
    at: r.at,
    productName: r.productName,
    reply: r.replyContent ? { content: r.replyContent, at: r.replyAt! } : null,
  }));
}

/**
 * 사업자 답글 — 리뷰당 1건, 수정 가능 (FR-REV-020).
 * **사업자는 리뷰를 지우거나 숨길 수 없다.** 부적절한 리뷰는 신고로 간다(FR-ADM-060) —
 * 사업자가 임의로 지울 수 있으면 리뷰 신뢰도가 0 이 된다.
 */
export async function upsertReply(businessId: string, memberId: string, reviewId: string, input: ReplyInput): Promise<void> {
  // 남의 사업장 리뷰에 답글을 다는 경로를 막는다 — 404 로 존재도 알리지 않는다
  const [r] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.businessId, businessId), eq(reviews.status, "PUBLISHED"))).limit(1);
  if (!r) throw new HttpError(404, "NOT_FOUND");
  await db
    .insert(reviewReplies)
    .values({ reviewId, memberId, content: input.content })
    .onConflictDoUpdate({ target: reviewReplies.reviewId, set: { content: input.content, updatedAt: new Date() } });
}

/** 사업장 id → 공개 리뷰 페이지를 그릴 최소 정보 (`/@{slug}/reviews`) */
export async function businessNameOf(businessId: string): Promise<string | null> {
  const [b] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return b?.name ?? null;
}

/** 답글을 지운다 — 사업자가 자기 답글을 거둘 수는 있다 (리뷰는 못 지운다) */
export async function deleteReply(businessId: string, reviewId: string): Promise<void> {
  const [r] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.businessId, businessId))).limit(1);
  if (!r) throw new HttpError(404, "NOT_FOUND");
  await db.delete(reviewReplies).where(eq(reviewReplies.reviewId, reviewId));
}


/** 본인 리뷰 한 건 — 수정 화면이 채워 넣을 값과 수정 가능 판정에 필요한 시각 */
export async function myReviewOf(customerId: string, reviewId: string) {
  const [r] = await db
    .select({ id: reviews.id, rating: reviews.rating, content: reviews.content, createdAt: reviews.createdAt, updatedAt: reviews.updatedAt, status: reviews.status })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.customerId, customerId)))
    .limit(1);
  return r ?? null;
}
