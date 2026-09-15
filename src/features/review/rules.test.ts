import { describe, expect, it } from "vitest";
import { ratingHistogram, reviewEditState, reviewEligibility, reviewInputSchema, type ReviewSubject } from "./rules";

/**
 * 리뷰에서 규칙인 것 — **누가 쓸 수 있나**와 **언제까지 고칠 수 있나**.
 * 화면과 서버가 같은 답을 내야 하는 자리라 표를 여기 하나로 두고 테스트로 묶는다.
 */
const at = (iso: string) => new Date(iso);
const done: ReviewSubject = { status: "COMPLETED", endAt: at("2026-09-01T02:00:00Z"), createdVia: "WEB", reviewStatus: null };

describe("reviewEligibility", () => {
  it("방문을 마친 본인 예약이면 30일 안에 쓸 수 있다", () => {
    const r = reviewEligibility(done, at("2026-09-20T00:00:00Z"));
    expect(r.can).toBe(true);
    expect(r.deadline?.toISOString()).toBe("2026-10-01T02:00:00.000Z");
  });

  it("30일이 지나면 막고, 언제까지였는지 알려 준다", () => {
    // 이유를 구분해 주지 않으면 화면이 "안 됩니다" 한 문장밖에 못 낸다
    expect(reviewEligibility(done, at("2026-10-01T02:00:00Z"))).toMatchObject({ can: false, reason: "WINDOW_PASSED" });
  });

  it("아직 방문 전이거나 취소된 예약은 대상이 아니다", () => {
    expect(reviewEligibility({ ...done, status: "CONFIRMED" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "NOT_COMPLETED" });
    expect(reviewEligibility({ ...done, status: "NO_SHOW" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "NOT_COMPLETED" });
  });

  it("워크인은 쓸 수 없다 — 사장님이 자기 가게에 별 다섯을 찍는 경로다", () => {
    expect(reviewEligibility({ ...done, createdVia: "WALK_IN" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "WALK_IN" });
  });

  it("지운 리뷰가 있어도 다시 쓰지 못한다", () => {
    // "지우고 다시 쓰기" 로 평점을 갈아 치우는 길을 열지 않는다 — 수정은 7일 1회로 따로 있다
    expect(reviewEligibility({ ...done, reviewStatus: "DELETED" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "ALREADY_WRITTEN" });
    expect(reviewEligibility({ ...done, reviewStatus: "PUBLISHED" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "ALREADY_WRITTEN" });
  });
});

describe("reviewEditState", () => {
  const made = { createdAt: at("2026-09-01T00:00:00Z"), updatedAt: at("2026-09-01T00:00:00Z"), status: "PUBLISHED" };

  it("7일 안에 한 번 고칠 수 있다", () => {
    expect(reviewEditState(made, at("2026-09-05T00:00:00Z"))).toMatchObject({ can: true });
  });

  it("한 번 고쳤으면 끝이다", () => {
    // 칼럼을 늘리지 않고 updatedAt > createdAt 으로 센다
    expect(reviewEditState({ ...made, updatedAt: at("2026-09-02T00:00:00Z") }, at("2026-09-03T00:00:00Z"))).toMatchObject({ can: false, reason: "EDITED" });
  });

  it("7일이 지나면 못 고친다", () => {
    expect(reviewEditState(made, at("2026-09-08T00:00:00Z"))).toMatchObject({ can: false, reason: "WINDOW_PASSED" });
  });

  it("숨겨졌거나 지워진 리뷰는 고칠 대상이 아니다", () => {
    expect(reviewEditState({ ...made, status: "HIDDEN" }, at("2026-09-02T00:00:00Z"))).toMatchObject({ reason: "NOT_PUBLISHED" });
  });
});

describe("ratingHistogram", () => {
  it("없는 점수도 0 으로 남긴다", () => {
    // 빼면 막대 그래프가 칸을 건너뛰어 "3점이 하나도 없다" 가 안 보인다
    expect(ratingHistogram([{ rating: 5, count: 2 }, { rating: 1, count: 1 }])).toEqual([
      { rating: 5, count: 2 },
      { rating: 4, count: 0 },
      { rating: 3, count: 0 },
      { rating: 2, count: 0 },
      { rating: 1, count: 1 },
    ]);
  });
});

describe("reviewInputSchema", () => {
  it("별점과 10자 이상 본문이 필수다", () => {
    expect(reviewInputSchema.safeParse({ rating: 5, content: "짧다" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 0, content: "열 글자는 넘기게 적어 봅니다" }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 5, content: "열 글자는 넘기게 적어 봅니다" }).success).toBe(true);
  });
});
