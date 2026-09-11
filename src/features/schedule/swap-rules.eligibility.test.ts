import { describe, expect, it } from "vitest";
import { swapEligibility } from "./swap-rules";

/**
 * 폼을 감출 때 **이유를 말하는가**. 로컬 테스트에서 "페이지는 보이는데 어떻게 하는지 모르겠다" 로 막힌 자리다 —
 * 특히 상대가 0명인 경우가 조용했다(본인 담당 자원은 있어 기존 안내도 안 떴다).
 */
describe("swapEligibility", () => {
  const ok = { readOnly: false, hasOwnResource: true, partnerCount: 1 };

  it("셋이 다 갖춰지면 요청할 수 있다", () => {
    expect(swapEligibility(ok)).toEqual({ canRequest: true, reason: null });
  });

  it("막는 자리마다 이유가 있다 — 조용히 잠그지 않는다", () => {
    for (const input of [
      { ...ok, readOnly: true },
      { ...ok, hasOwnResource: false },
      { ...ok, partnerCount: 0 },
    ]) {
      const r = swapEligibility(input);
      expect(r.canRequest, JSON.stringify(input)).toBe(false);
      expect(r.reason, JSON.stringify(input)).toBeTruthy();
    }
  });

  it("상대가 0명인 것과 내 담당 자원이 없는 것은 다른 문장이다", () => {
    const noPartner = swapEligibility({ ...ok, partnerCount: 0 }).reason;
    const noMine = swapEligibility({ ...ok, hasOwnResource: false }).reason;
    expect(noPartner).not.toBe(noMine);
    expect(noPartner).toMatch(/상대/);
    expect(noMine).toMatch(/담당자 자원/);
  });

  it("읽기 전용이 가장 먼저다 — 나머지가 갖춰져도 못 한다", () => {
    expect(swapEligibility({ readOnly: true, hasOwnResource: false, partnerCount: 0 }).reason).toMatch(/읽기 전용/);
  });
});
