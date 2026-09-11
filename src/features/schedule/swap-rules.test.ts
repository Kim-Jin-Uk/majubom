import { describe, expect, it } from "vitest";
import { isSwapOpen, snapshotKey, SWAP_RULES, swapLegs, type SwapShape, type SwapStatus } from "./swap-rules";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const give: SwapShape = { swapType: "GIVE", requesterResourceId: A, targetResourceId: B, requestDate: "2026-10-05", targetDate: null, reassignRequester: true, reassignTarget: null };
const exchange: SwapShape = { ...give, swapType: "EXCHANGE", targetDate: "2026-10-12", reassignRequester: true, reassignTarget: false };

describe("전이 표", () => {
  it("응답은 대상만, 철회는 요청자만, 거부는 사장님만", () => {
    expect(SWAP_RULES.ACCEPT.by).toEqual(["TARGET"]);
    expect(SWAP_RULES.CANCEL.by).toEqual(["REQUESTER"]);
    expect(SWAP_RULES.DENY.by).toEqual(["OWNER"]);
  });

  it("승인은 사장님 — 자동승인일 때만 대상도 (그 조건은 사업장 설정이라 실행부가 본다)", () => {
    expect(SWAP_RULES.APPROVE.by).toContain("OWNER");
    expect(SWAP_RULES.APPROVE.by).toContain("TARGET");
    expect(SWAP_RULES.APPROVE.from).toEqual(["ACCEPTED"]);
  });

  it("끝난 요청은 어떤 동작으로도 되살아나지 않는다", () => {
    const terminal: SwapStatus[] = ["REJECTED", "APPROVED", "DENIED", "CANCELED", "EXPIRED"];
    for (const s of terminal) {
      expect(isSwapOpen(s), s).toBe(false);
      for (const [action, rule] of Object.entries(SWAP_RULES)) expect(rule.from, `${s} → ${action}`).not.toContain(s);
    }
  });

  it("만료는 응답을 기다리는 동안만 — 수락된 뒤 사장님 승인을 기다리는 건은 만료되지 않는다", () => {
    expect(SWAP_RULES.EXPIRE.from).toEqual(["PENDING"]);
  });
});

describe("방향 분해", () => {
  it("GIVE 는 한 방향 — 요청자가 쉬고 대상이 대신 선다", () => {
    expect(swapLegs(give)).toEqual([{ date: "2026-10-05", giverResourceId: A, takerResourceId: B, reassign: true }]);
  });

  it("EXCHANGE 는 두 방향이고 이관 여부가 방향마다 다르다 — bool 하나로는 표현할 수 없다", () => {
    expect(swapLegs(exchange)).toEqual([
      { date: "2026-10-05", giverResourceId: A, takerResourceId: B, reassign: true },
      { date: "2026-10-12", giverResourceId: B, takerResourceId: A, reassign: false },
    ]);
  });

  it("reassignTarget 이 null 이면 이관하지 않는다 — 기본값은 '유지' 다", () => {
    expect(swapLegs({ ...exchange, reassignTarget: null })[1].reassign).toBe(false);
  });

  it("EXCHANGE 인데 상대 근무일이 없으면 조용히 한 방향으로 처리하지 않는다", () => {
    expect(() => swapLegs({ ...exchange, targetDate: null })).toThrow();
  });
});

describe("스냅샷 비교", () => {
  it("순서와 중복에 흔들리지 않는다 — 재조회 결과의 정렬을 믿지 않는다", () => {
    expect(snapshotKey(["b", "a"])).toBe(snapshotKey(["a", "b", "a"]));
  });
  it("한 건이라도 다르면 다른 키다", () => {
    expect(snapshotKey(["a", "b"])).not.toBe(snapshotKey(["a"]));
    expect(snapshotKey(["a"])).not.toBe(snapshotKey(["a", "c"]));
  });
});
