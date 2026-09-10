import { describe, expect, it } from "vitest";
import { firstBookableDate } from "@/features/booking/slots";
import { dayState, windowFor, type SlotDay } from "./slots-client";

/**
 * 위젯의 날짜 경계는 **백엔드의 날짜 범위(`dateInRange`)와 같은 하한**을 써야 한다.
 * 어긋나면 "서버는 여는데 손님은 누를 수 없는 날" 이 생긴다 — 실제로 A7 을 고칠 때 그랬다:
 * `slots.ts` 만 열고 달력은 `date < today` 로 막아 둬, 고치려던 상황이 화면에 그대로 남았다.
 */
const NIGHT = { openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "20:00", close: "02:00" })), timezone: "Asia/Seoul" };
const DAY = { openingHours: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, open: "10:00", close: "20:00" })), timezone: "Asia/Seoul" };
const at = (iso: string) => new Date(iso).getTime();

describe("firstBookableDate — 위젯 하한의 근거", () => {
  it("심야 영업 가게를 새벽에 열면 어제가 하한이다", () => {
    expect(firstBookableDate(NIGHT, at("2026-10-02T00:10:00+09:00"))).toBe("2026-10-01");
    expect(firstBookableDate(NIGHT, at("2026-10-02T02:00:00+09:00")), "영업이 끝난 뒤").toBe("2026-10-02");
  });

  it("자정을 넘기지 않는 가게는 언제나 오늘이다", () => {
    expect(firstBookableDate(DAY, at("2026-10-02T00:10:00+09:00"))).toBe("2026-10-02");
    expect(firstBookableDate(DAY, at("2026-10-02T13:00:00+09:00"))).toBe("2026-10-02");
  });
});

describe("windowFor — 조회 구간", () => {
  const b = (firstDate: string, lastDate: string) => ({ firstDate, lastDate });

  it("하한은 오늘이 아니라 가장 이른 영업일이다", () => {
    // 10-02 새벽, 어제(10-01)가 아직 영업 중 → 10월 조회는 10-01 부터
    expect(windowFor("2026-10-01", b("2026-10-01", "2026-11-01"), 31)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("달을 넘어간 어제도 조회한다 — 1일 새벽에 전달 마지막 날이 열려 있다", () => {
    expect(windowFor("2026-09-01", b("2026-09-30", "2026-10-31"), 30), "9월 뷰").toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("정책 밖은 애초에 묻지 않는다", () => {
    expect(windowFor("2026-12-01", b("2026-10-05", "2026-11-04"), 31), "전부 상한 밖").toBeNull();
    expect(windowFor("2026-11-01", b("2026-10-05", "2026-11-04"), 30)).toEqual({ from: "2026-11-01", to: "2026-11-04" });
  });

  it("지난 달은 조회하지 않는다", () => {
    expect(windowFor("2026-08-01", b("2026-10-05", "2026-11-04"), 31)).toBeNull();
  });
});

describe("dayState — 달력 칸 하나", () => {
  const bounds = { firstDate: "2026-10-01", lastDate: "2026-10-31" };
  const days: SlotDay[] = [
    { date: "2026-10-01", slots: [{ start: "2026-10-02T01:00:00+09:00", end: "2026-10-02T02:00:00+09:00", remaining: 1 }] },
    { date: "2026-10-02", slots: [] },
  ];

  it("아직 영업 중인 어제는 열려 있다 — 이 한 줄이 A7 픽스의 요점이다", () => {
    expect(dayState("2026-10-01", bounds, days)).toBe("open");
  });

  it("자리가 없는 날과 기간 밖은 다르게 읽는다", () => {
    expect(dayState("2026-10-02", bounds, days)).toBe("closed");
    expect(dayState("2026-09-30", bounds, days)).toBe("out");
    expect(dayState("2026-11-01", bounds, days)).toBe("out");
  });

  it("아직 못 읽은 것과 마감은 다른 상태다", () => {
    expect(dayState("2026-10-05", bounds, null), "로딩 중").toBe("unknown");
    expect(dayState("2026-10-05", bounds, days), "응답에 없는 날 = 자리 없음").toBe("closed");
  });
});
