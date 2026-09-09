import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES, categoryLabel } from "./policy-defaults";

/**
 * 업종 코드는 DB 값이고 화면·`<title>`·JSON-LD 에는 사람이 읽는 이름이 나가야 한다.
 * 공개 홈이 `nail` 을 그대로 내보내던 것을 고치면서 만든 함수라, 모든 코드에 이름이 있는지 여기서 고정한다.
 */
describe("categoryLabel", () => {
  it("코드마다 사람이 읽는 이름이 있다", () => {
    expect(categoryLabel("nail")).toBe("네일 · 왁싱");
    expect(categoryLabel("hair")).toBe("미용실 · 헤어");
    for (const [code, label] of BUSINESS_CATEGORIES) expect(categoryLabel(code), code).toBe(label);
  });

  it("모르는 코드는 기타 — 코드값이 손님에게 보이는 것보다 낫다", () => {
    // 목록이 바뀌기 전에 저장된 값, 또는 시드·마이그레이션이 넣은 값
    expect(categoryLabel("cafe")).toBe("기타");
    expect(categoryLabel("")).toBe("기타");
  });
});
