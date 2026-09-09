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
  | { kind: "SYSTEM" };

export type Rule = {
  by: Array<"CUSTOMER" | "CONSOLE" | "SYSTEM">;
  /** OWNER 만 (오판 교정) */
  ownerOnly?: boolean;
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

/** `${from}>${to}` */
export const RULES: Record<string, Rule> = {
  "REQUESTED>CONFIRMED": { by: ["CONSOLE"], revalidate: true },
  "REQUESTED>REJECTED": { by: ["CONSOLE"], reasonRequired: true },
  "REQUESTED>CANCELED_BY_USER": { by: ["CUSTOMER"] },
  "REQUESTED>CANCELED_BY_BIZ": { by: ["CONSOLE", "SYSTEM"], reasonRequired: true },
  "REQUESTED>EXPIRED": { by: ["SYSTEM"] },
  "CONFIRMED>CANCELED_BY_USER": { by: ["CUSTOMER"], guard: CANCEL_DEADLINE },
  // 명세 표의 이 행에는 시스템이 없다 — 일괄 취소(휴무 등록 등)가 건드리는 것은 REQUESTED 까지다
  "CONFIRMED>CANCELED_BY_BIZ": { by: ["CONSOLE"], reasonRequired: true },
  "CONFIRMED>COMPLETED": {
    by: ["CONSOLE"],
    guard: (r, now) => {
      if (now < r.startAt) throw new HttpError(409, "TOO_EARLY", { startAt: r.startAt.toISOString() });
    },
  },
  "CONFIRMED>NO_SHOW": {
    by: ["CONSOLE", "SYSTEM"],
    guard: (r, now) => {
      if (now < r.endAt) throw new HttpError(409, "TOO_EARLY", { endAt: r.endAt.toISOString() });
    },
  },
  // 오판 교정 — 자동 전환이 매니저의 미처리일 수 있으므로 되돌릴 길이 있어야 한다
  "NO_SHOW>COMPLETED": { by: ["CONSOLE"], ownerOnly: true, reasonRequired: true },
  "COMPLETED>NO_SHOW": { by: ["CONSOLE"], ownerOnly: true, reasonRequired: true },
};

