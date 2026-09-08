import { describe, expect, it } from "vitest";
import { isPolicyTouched, policySchema } from "./policy";
import { DEFAULT_POLICY } from "./policy-defaults";

describe("policySchema (FR-BIZ-020)", () => {
  it("기본값은 통과한다", () => {
    expect(policySchema.safeParse(DEFAULT_POLICY).success).toBe(true);
  });
  it("범위를 벗어나면 필드별 한국어 메시지", () => {
    const r = policySchema.safeParse({ ...DEFAULT_POLICY, cancelDeadlineHours: 999, maxActivePerCustomer: 0 });
    expect(r.success).toBe(false);
    const msgs = Object.fromEntries(r.error!.issues.map((i) => [i.path[0], i.message]));
    expect(msgs.cancelDeadlineHours).toBe("168시간 이하");
    expect(msgs.maxActivePerCustomer).toBe("1건 이상");
  });
  it("소수·누락 키는 거절 (전체 교체 API 라 부분 입력을 받지 않는다)", () => {
    expect(policySchema.safeParse({ ...DEFAULT_POLICY, minLeadTimeMin: 1.5 }).success).toBe(false);
    const { autoConfirm: _drop, ...rest } = DEFAULT_POLICY;
    expect(policySchema.safeParse(rest).success).toBe(false);
  });
});

describe("isPolicyTouched", () => {
  it("기본값과 같으면 false, 하나라도 다르면 true", () => {
    expect(isPolicyTouched({ ...DEFAULT_POLICY })).toBe(false);
    expect(isPolicyTouched({ ...DEFAULT_POLICY, autoConfirm: false })).toBe(true);
  });
});
