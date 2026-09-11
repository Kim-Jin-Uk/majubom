import { HttpError } from "@/features/auth/errors";
import type { ReservationStatus } from "@/features/booking/slot-types";

/**
 * 예약 상태 전이 표 (02 §2.3). **순수하다** — DB 도 시계도 모른다. 실행은 `transitions.ts`.
 * 표를 여기 하나로 두는 이유: 라우트마다 조건을 들고 있으면 곧 어긋난다. 표에 없는 전이는 전부 409 INVALID_TRANSITION 이다.
 */

/** 전이 판정에 필요한 예약의 모습 (DB 행의 투영) */
export type TransitionSubject = {
  status: ReservationStatus;
  startAt: Date;
  endAt: Date;
  /** 생성 시점 스냅샷 */
  cancelDeadlineHours: number;
};

export type TransitionActor =
  | { kind: "CUSTOMER"; uid: string }
  /** canViewAll: `permissions.viewAllReservations`. **보이는 범위**를 넓힐 뿐, 처리 권한은 넓히지 않는다 (FR-BOOK-030) */
  | { kind: "CONSOLE"; uid: string; role: "OWNER" | "MANAGER"; memberId: string; businessId: string; canViewAll: boolean }
  /** 배치 — 만료·자동 노쇼. actorId 는 null 로 남는다 */
  | { kind: "SYSTEM" }
  /**
   * 운영자. 사업장 차단(FR-ADM-020)으로 남은 예약을 정리할 때만 쓴다 — 배치(SYSTEM)와 나누는 이유는
   * **사람이 사유를 적고 책임을 지기 때문**이다. 확정된 예약을 아무도 모르게 취소하는 경로는 만들지 않는다
   */
  | { kind: "ADMIN"; uid: string };

export type Rule = {
  by: Array<TransitionActor["kind"]>;
  /** OWNER 만 (오판 교정) */
  ownerOnly?: boolean;
  /**
   * **담당이 아닌 매니저도** 할 수 있다 (FR-BOOK-030 완화 — `LATER.md` L-32).
   *
   * 기본은 "본인 담당 자원의 건만" 이다. 빠뜨렸을 때 좁은 쪽으로 틀리라고 그렇게 뒀다 —
   * 새 전이를 추가한 날 남의 예약이 조용히 열리면 안 된다.
   *
   * 여는 것은 **사후 기록과 취소**(완료·노쇼·취소) 그리고 **승인·거절**이다.
   * 앞의 셋은 동료가 자리에 없을 때 대신 정리해 주는 일이고, 안 하면 그 예약이 영원히 `CONFIRMED` 로 남아
   * 노쇼 통계와 가동률을 망친다. 화면은 남의 담당 건일 때 "OOO 담당입니다" 를 먼저 묻는다.
   */
  anyManager?: boolean;
  /**
   * 남의 담당 건에 이 전이를 하면 **담당이 그 사람에게 넘어온다** (9/11 결정).
   *
   * 승인·거절에만 붙인다. 그건 매장이 손님에게 하는 **약속**이라, 약속한 사람과 그날 서는 사람이 달라지면
   * 손님은 A 의 이름으로 확정 메일을 받고 매장에는 B 가 있다. 대신 승인한다는 것은 **내가 맡는다**는 뜻이다.
   * 완료·노쇼·취소는 이미 끝난 일의 기록이라 담당을 옮길 이유가 없다.
   *
   * 옮길 자원이 없거나(담당자 자원 미연결) 그 시각에 차 있으면 전이 자체가 실패한다 — 승인만 되고
   * 담당이 그대로 남는 상태를 만들지 않는다(같은 트랜잭션).
   */
  takeOver?: boolean;
  reasonRequired?: boolean;
  /** 추가 조건. 어기면 HttpError 를 던진다 */
  guard?: (r: TransitionSubject, now: Date) => void;
  /** 승인처럼 다른 예약과의 충돌을 다시 봐야 하는 전이 */
  revalidate?: boolean;
};

const CANCEL_DEADLINE = (r: TransitionSubject, now: Date) => {
  // 마감은 **예약 생성 시점 스냅샷**을 따른다 — 사업자가 나중에 24→48시간으로 늘려도 이미 잡힌 예약의 조건은 그대로다 (FR-BIZ-020)
  const deadline = r.startAt.getTime() - r.cancelDeadlineHours * 3_600_000;
  if (now.getTime() >= deadline) throw new HttpError(409, "CANCEL_DEADLINE_PASSED", { deadline: new Date(deadline).toISOString() });
};

/**
 * 그 전이 뒤 **손님에게** 나가는 메일 (FR-NOTI-010 · #57). 표에 없는 도착 상태는 메일이 없다.
 *
 * 전이 표 바로 옆에 두는 이유: "어떤 전이인가" 와 "그래서 손님에게 뭐라고 알리는가" 가 따로 살면
 * 전이를 하나 추가한 날 알림이 조용히 빠진다. `REQUESTED` 는 전이가 아니라 생성이라 여기 없다 (`create.ts`).
 *
 * 없는 것들의 이유:
 * - `CANCELED_BY_USER` — 손님이 스스로 한 일이다. "취소되었습니다" 를 받으면 매장이 취소한 줄 안다
 * - `COMPLETED` · `NO_SHOW` — 매장의 사후 기록이다. 손님이 할 일이 없다
 */
export const CUSTOMER_MAIL_ON = {
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  CANCELED_BY_BIZ: "CANCELED_BY_BIZ",
  EXPIRED: "EXPIRED",
} as const satisfies Partial<Record<ReservationStatus, string>>;

/**
 * 손님 메일 갈래. 전이가 아닌 둘이 섞여 있다 — `REQUESTED` 는 생성(`create.ts`),
 * `REASSIGNED` 는 상태가 그대로인 채 담당자만 바뀌는 근무 교대(`schedule/swaps.ts`)다.
 */
export type ReservationMailEvent = "REQUESTED" | "REASSIGNED" | (typeof CUSTOMER_MAIL_ON)[keyof typeof CUSTOMER_MAIL_ON];

export function customerMailFor(to: ReservationStatus): ReservationMailEvent | null {
  return CUSTOMER_MAIL_ON[to as keyof typeof CUSTOMER_MAIL_ON] ?? null;
}

/** `${from}>${to}` */
export const RULES: Record<string, Rule> = {
  "REQUESTED>CONFIRMED": { by: ["CONSOLE"], revalidate: true, anyManager: true, takeOver: true },
  "REQUESTED>REJECTED": { by: ["CONSOLE"], reasonRequired: true, anyManager: true, takeOver: true },
  "REQUESTED>CANCELED_BY_USER": { by: ["CUSTOMER"] },
  "REQUESTED>CANCELED_BY_BIZ": { by: ["CONSOLE", "SYSTEM", "ADMIN"], reasonRequired: true, anyManager: true },
  "REQUESTED>EXPIRED": { by: ["SYSTEM"] },
  "CONFIRMED>CANCELED_BY_USER": { by: ["CUSTOMER"], guard: CANCEL_DEADLINE },
  // 명세 표의 이 행에는 시스템이 없다 — 일괄 취소(휴무 등록 등)가 건드리는 것은 REQUESTED 까지다.
  // 운영자(ADMIN)는 예외다: 사업장을 차단하면 확정 예약도 지킬 수 없고, 손님이 빈 가게에 가는 것보다
  // 사유가 적힌 취소 메일을 받는 편이 낫다 (FR-ADM-020 "예약 일괄 취소 여부 선택")
  "CONFIRMED>CANCELED_BY_BIZ": { by: ["CONSOLE", "ADMIN"], reasonRequired: true, anyManager: true },
  "CONFIRMED>COMPLETED": {
    by: ["CONSOLE"],
    anyManager: true,
    guard: (r, now) => {
      if (now < r.startAt) throw new HttpError(409, "TOO_EARLY", { startAt: r.startAt.toISOString() });
    },
  },
  "CONFIRMED>NO_SHOW": {
    by: ["CONSOLE", "SYSTEM"],
    anyManager: true,
    guard: (r, now) => {
      if (now < r.endAt) throw new HttpError(409, "TOO_EARLY", { endAt: r.endAt.toISOString() });
    },
  },
  // 오판 교정 — 자동 전환이 매니저의 미처리일 수 있으므로 되돌릴 길이 있어야 한다
  "NO_SHOW>COMPLETED": { by: ["CONSOLE"], ownerOnly: true, reasonRequired: true },
  "COMPLETED>NO_SHOW": { by: ["CONSOLE"], ownerOnly: true, reasonRequired: true },
};

