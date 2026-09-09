import { describe, expect, it } from "vitest";
import { HttpError } from "@/features/auth/errors";
import { RULES, type TransitionSubject } from "./transition-rules";

/**
 * 전이 표가 명세(02 §2.3)와 같은지 — 표가 조용히 넓어지거나 좁아지는 것을 막는다.
 * 여기 없는 전이는 실행부에서 전부 409 `INVALID_TRANSITION` 이 된다.
 */

const ALLOWED = [
  ["REQUESTED", "CONFIRMED"],
  ["REQUESTED", "REJECTED"],
  ["REQUESTED", "CANCELED_BY_USER"],
  ["REQUESTED", "CANCELED_BY_BIZ"],
  ["REQUESTED", "EXPIRED"],
  ["CONFIRMED", "CANCELED_BY_USER"],
  ["CONFIRMED", "CANCELED_BY_BIZ"],
  ["CONFIRMED", "COMPLETED"],
  ["CONFIRMED", "NO_SHOW"],
  ["NO_SHOW", "COMPLETED"],
  ["COMPLETED", "NO_SHOW"],
] as const;

describe("전이 표", () => {
  it("명세의 11개 전이만 있다", () => {
    expect(Object.keys(RULES).sort()).toEqual(ALLOWED.map(([f, t]) => `${f}>${t}`).sort());
  });

  it("사유가 필수인 전이 — 거절 · 매장 취소 · 교정 둘", () => {
    const need = Object.entries(RULES).filter(([, r]) => r.reasonRequired).map(([k]) => k);
    expect(need.sort()).toEqual(["COMPLETED>NO_SHOW", "CONFIRMED>CANCELED_BY_BIZ", "NO_SHOW>COMPLETED", "REQUESTED>CANCELED_BY_BIZ", "REQUESTED>REJECTED"]);
  });

  it("오판 교정은 OWNER 만", () => {
    expect(Object.entries(RULES).filter(([, r]) => r.ownerOnly).map(([k]) => k).sort()).toEqual(["COMPLETED>NO_SHOW", "NO_SHOW>COMPLETED"]);
  });

  it("고객이 직접 할 수 있는 것은 취소뿐", () => {
    expect(Object.entries(RULES).filter(([, r]) => r.by.includes("CUSTOMER")).map(([k]) => k).sort()).toEqual(["CONFIRMED>CANCELED_BY_USER", "REQUESTED>CANCELED_BY_USER"]);
  });

  it("배치가 하는 것은 만료와 자동 노쇼(+ 시스템 일괄 취소)", () => {
    expect(Object.entries(RULES).filter(([, r]) => r.by.includes("SYSTEM")).map(([k]) => k).sort()).toEqual(["CONFIRMED>NO_SHOW", "REQUESTED>CANCELED_BY_BIZ", "REQUESTED>EXPIRED"]);
  });
});

describe("조건", () => {
  const at = (h: number): TransitionSubject => ({ status: "CONFIRMED", startAt: new Date(Date.now() + h * 3_600_000), endAt: new Date(Date.now() + (h + 1) * 3_600_000), cancelDeadlineHours: 24 });
  const run = (key: string, r: TransitionSubject, now = new Date()) => () => RULES[key].guard?.(r, now);

  it("취소 마감은 생성 시점 스냅샷(cancelDeadlineHours)을 쓴다", () => {
    expect(run("CONFIRMED>CANCELED_BY_USER", at(25))).not.toThrow(); // 25시간 뒤 시작 — 마감 24시간 전이라 아직 된다
    expect(run("CONFIRMED>CANCELED_BY_USER", at(23))).toThrow(HttpError);
    // 마감이 0 이면 시작 직전까지 취소된다
    expect(run("CONFIRMED>CANCELED_BY_USER", { ...at(1), cancelDeadlineHours: 0 })).not.toThrow();
  });

  it("완료는 시작 시각 이후, 노쇼는 종료 시각 이후", () => {
    expect(run("CONFIRMED>COMPLETED", at(1))).toThrow(HttpError);
    expect(run("CONFIRMED>COMPLETED", at(-0.5))).not.toThrow();
    expect(run("CONFIRMED>NO_SHOW", at(-0.5))).toThrow(HttpError); // 아직 진행 중
    expect(run("CONFIRMED>NO_SHOW", at(-2))).not.toThrow();
  });
});
