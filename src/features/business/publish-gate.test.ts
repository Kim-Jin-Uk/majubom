import { describe, expect, it } from "vitest";
import { wizardSteps, type PublishStatus } from "./publish-gate";

const base: PublishStatus = { approved: false, businessStatus: "PENDING", infoComplete: false, activeResources: 0, activeProducts: 0, sitePublished: false, readyToPublish: false, live: false, publicUrl: "http://x/@b-1" };

describe("wizardSteps (기획서 6.1)", () => {
  it("1·2·3 만 필수, 채팅 단계는 플래그가 꺼져 있으면 available=false", () => {
    const s = wizardSteps(base, { chatEnabled: false, policyTouched: false, brandTouched: false });
    expect(s.map((x) => x.required)).toEqual([true, true, true, false, false, false]);
    expect(s[5].available).toBe(false);
    expect(wizardSteps(base, { chatEnabled: true, policyTouched: false, brandTouched: false })[5].available).toBe(true);
  });
  it("완료 판정은 실제 데이터에서 온다", () => {
    const s = wizardSteps({ ...base, infoComplete: true, activeResources: 2 }, { chatEnabled: false, policyTouched: true, brandTouched: false });
    expect(s.filter((x) => x.done).map((x) => x.n)).toEqual([1, 2, 5]);
  });
});
