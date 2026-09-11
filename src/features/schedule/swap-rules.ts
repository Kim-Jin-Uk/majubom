import type { ISODate } from "@/features/booking/slot-types";

/**
 * 근무 교대의 **순수한 부분** (FR-SHIFT-010/020/030). DB·시계 없음.
 *
 * 여기 두는 이유는 두 가지다:
 * - 상태 전이를 한 표로 묶는다. 라우트마다 "이 상태에서 이걸 할 수 있나" 를 따로 쓰면 곧 어긋난다 (예약 전이 표와 같은 이유)
 * - **방향**을 한 곳에서 푼다. GIVE 는 한 방향, EXCHANGE 는 두 방향이고, 각 방향마다 "누가 쉬고 누가 대신 서는가" 와
 *   "그날 예약을 넘길 것인가" 가 따로 정해진다. 이 분해를 승인 로직 안에 풀어 두면 EXCHANGE 의 반대 방향이 조용히 빠진다
 */
export type SwapStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "APPROVED" | "DENIED" | "CANCELED" | "EXPIRED";
export type SwapAction = "ACCEPT" | "REJECT" | "CANCEL" | "APPROVE" | "DENY" | "EXPIRE";
/** 그 요청에서 이 사람이 누구인가 — 역할(OWNER/MANAGER)이 아니라 **자리**다 */
export type SwapSeat = "REQUESTER" | "TARGET" | "OWNER" | "SYSTEM";

/** 72시간 무응답이면 만료 (FR-SHIFT-010) */
export const SWAP_EXPIRE_HOURS = 72;

/**
 * `APPROVE` 를 대상 매니저도 할 수 있는 것은 `shiftAutoApprove=true` 일 때뿐이다 — 그 조건은 표가 아니라
 * 사업장 설정이라 실행부가 본다. 표는 "자리" 까지만 정한다.
 */
export const SWAP_RULES: Record<SwapAction, { from: SwapStatus[]; to: SwapStatus; by: SwapSeat[] }> = {
  ACCEPT: { from: ["PENDING"], to: "ACCEPTED", by: ["TARGET"] },
  REJECT: { from: ["PENDING"], to: "REJECTED", by: ["TARGET"] },
  CANCEL: { from: ["PENDING"], to: "CANCELED", by: ["REQUESTER"] },
  APPROVE: { from: ["ACCEPTED"], to: "APPROVED", by: ["OWNER", "TARGET"] },
  DENY: { from: ["ACCEPTED"], to: "DENIED", by: ["OWNER"] },
  EXPIRE: { from: ["PENDING"], to: "EXPIRED", by: ["SYSTEM"] },
};

/** 더 움직이지 않는 상태 — 목록에서 접고, 중복 요청 검사에서도 제외한다 */
export const isSwapOpen = (s: SwapStatus): boolean => s === "PENDING" || s === "ACCEPTED";

export type SwapShape = {
  swapType: "GIVE" | "EXCHANGE";
  requesterResourceId: string;
  targetResourceId: string;
  requestDate: ISODate;
  targetDate: ISODate | null;
  reassignRequester: boolean;
  reassignTarget: boolean | null;
};

/**
 * 한 방향. `giver` 가 그날 쉬고 `taker` 가 대신 선다 — **taker 의 그날에 EXTRA 를 만든다**(giver 의 날이 아니다).
 * `reassign` 이면 그날 giver 의 예약이 taker 에게 넘어가고, 아니면 giver 가 그 시간만 나온다(EXTRA 로 남는다).
 */
export type SwapLeg = { date: ISODate; giverResourceId: string; takerResourceId: string; reassign: boolean };

export function swapLegs(s: SwapShape): SwapLeg[] {
  const give: SwapLeg = { date: s.requestDate, giverResourceId: s.requesterResourceId, takerResourceId: s.targetResourceId, reassign: s.reassignRequester };
  if (s.swapType === "GIVE") return [give];
  if (!s.targetDate) throw new Error("EXCHANGE 인데 targetDate 가 없다 — DB CHECK 가 막아야 하는 상태다");
  // 맞교대의 반대 방향. bool 하나로는 표현할 수 없다 (FR-SHIFT-030)
  return [give, { date: s.targetDate, giverResourceId: s.targetResourceId, takerResourceId: s.requesterResourceId, reassign: s.reassignTarget === true }];
}

/** 스냅샷 비교용 — 순서·중복에 흔들리지 않게 */
export const snapshotKey = (ids: string[]): string => [...new Set(ids)].sort().join(",");
