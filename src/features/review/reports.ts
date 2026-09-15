import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { reports, reviews, users } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";

/**
 * 리뷰 신고 접수 (FR-ADM-060 의 입구, #94). **처리 화면은 여기 없다** — 그건 관리자 에픽(#70)이다.
 * 여기서 하는 일은 큐에 한 줄을 넣고, 신고된 리뷰를 `REPORTED` 로 돌려 공개에서 즉시 내리는 것뿐이다.
 */
export const reportInputSchema = z.object({
  reason: z.string().trim().min(5, "무엇이 문제인지 조금만 더 적어 주세요").max(500, "500자 이내로 적어 주세요"),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

/**
 * **신고하면 그 자리에서 내린다** (`REPORTED`). 검토가 끝날 때까지 두면, 정말 문제가 있는 글이
 * 3~5일 더 가게 페이지에 남는다. 반대로 장난 신고로 멀쩡한 글이 내려갈 수 있는데,
 * 그건 관리자가 되돌릴 수 있는 쪽이다 — 한쪽만 되돌릴 수 있으면 되돌릴 수 있는 쪽으로 기운다.
 *
 * 남용은 **한 사람이 같은 글을 한 번만** 신고할 수 있게 해 막는다. 여러 사람이 신고하면 줄이 여러 개 쌓이고,
 * 그 수 자체가 관리자에게 신호다.
 *
 * **ADMIN 은 신고할 수 없다** (명세): 스스로 열람권을 만드는 경로를 막는다.
 */
export async function reportReview(reporterId: string, reviewId: string, input: ReportInput): Promise<void> {
  const [reporter] = await db.select({ role: users.globalRole }).from(users).where(eq(users.id, reporterId)).limit(1);
  if (reporter?.role === "ADMIN") throw new HttpError(403, "ADMIN_CANNOT_REPORT");

  await db.transaction(async (tx) => {
    const [r] = await tx.select({ id: reviews.id, status: reviews.status, customerId: reviews.customerId }).from(reviews).where(eq(reviews.id, reviewId)).limit(1).for("update");
    // 이미 지워진 글은 신고할 것이 없다. 남의 리뷰 id 든 없는 id 든 같은 404 다
    if (!r || r.status === "DELETED") throw new HttpError(404, "NOT_FOUND");
    // 자기 글을 신고하는 길은 열 이유가 없다 — 지우면 된다
    if (r.customerId === reporterId) throw new HttpError(409, "OWN_REVIEW");

    const [dup] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, reporterId), eq(reports.targetType, "REVIEW"), eq(reports.targetId, reviewId)))
      .limit(1);
    if (dup) throw new HttpError(409, "ALREADY_REPORTED");

    await tx.insert(reports).values({ reporterId, targetType: "REVIEW", targetId: reviewId, reason: input.reason });
    // 이미 HIDDEN 인 글을 REPORTED 로 되돌리지 않는다 — 관리자가 내린 판단이 신고 한 건에 뒤집히면 안 된다
    if (r.status === "PUBLISHED") await tx.update(reviews).set({ status: "REPORTED" }).where(eq(reviews.id, reviewId));
  });
}
