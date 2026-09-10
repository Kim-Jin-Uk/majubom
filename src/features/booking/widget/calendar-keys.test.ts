import { describe, expect, it } from "vitest";
import { isCalendarKey, nextFocus, rovingDate } from "./calendar-keys";

/** 2026-10-01 은 목요일. 10월은 31일까지 */
const B = { firstDate: "2026-10-01", lastDate: "2026-10-31" };

describe("nextFocus — 달력 방향키 (APG)", () => {
  it("좌우는 하루, 위아래는 한 주", () => {
    expect(nextFocus("2026-10-15", "ArrowLeft", B)).toBe("2026-10-14");
    expect(nextFocus("2026-10-15", "ArrowRight", B)).toBe("2026-10-16");
    expect(nextFocus("2026-10-15", "ArrowUp", B)).toBe("2026-10-08");
    expect(nextFocus("2026-10-15", "ArrowDown", B)).toBe("2026-10-22");
  });

  it("Home·End 는 그 주의 일요일과 토요일 — 달을 넘어갈 수 있다", () => {
    // 10-15 는 목요일 → 그 주는 10-11(일) ~ 10-17(토)
    expect(nextFocus("2026-10-15", "Home", B)).toBe("2026-10-11");
    expect(nextFocus("2026-10-15", "End", B)).toBe("2026-10-17");
  });

  it("PageUp·PageDown 은 같은 날짜의 앞뒤 달", () => {
    const wide = { firstDate: "2026-01-01", lastDate: "2026-12-31" };
    expect(nextFocus("2026-10-15", "PageUp", wide)).toBe("2026-09-15");
    expect(nextFocus("2026-10-15", "PageDown", wide)).toBe("2026-11-15");
  });

  it("짧은 달로 갈 때는 말일로 맞춘다 — 없는 날짜에 초점을 두지 않는다", () => {
    const wide = { firstDate: "2026-01-01", lastDate: "2026-12-31" };
    expect(nextFocus("2026-03-31", "PageUp", wide), "2월은 28일까지").toBe("2026-02-28");
    expect(nextFocus("2026-01-31", "PageDown", wide)).toBe("2026-02-28");
  });

  it("경계 밖으로는 나가지 않는다 — 조회할 수 없는 날에 초점만 남으면 막다른 길이다", () => {
    expect(nextFocus("2026-10-01", "ArrowLeft", B)).toBe("2026-10-01");
    expect(nextFocus("2026-10-02", "ArrowUp", B), "일주일 전은 9월").toBe("2026-10-01");
    expect(nextFocus("2026-10-31", "ArrowRight", B)).toBe("2026-10-31");
    expect(nextFocus("2026-10-28", "ArrowDown", B), "일주일 뒤는 11월").toBe("2026-10-31");
  });

  it("자정을 넘겨 영업하는 가게의 하한(어제)까지 갈 수 있다", () => {
    const night = { firstDate: "2026-09-30", lastDate: "2026-10-31" };
    expect(nextFocus("2026-10-01", "ArrowLeft", night)).toBe("2026-09-30");
    expect(nextFocus("2026-09-30", "ArrowLeft", night)).toBe("2026-09-30");
  });

  it("아는 키만 다룬다", () => {
    expect(isCalendarKey("ArrowLeft")).toBe(true);
    expect(isCalendarKey("Enter"), "선택은 클릭이 맡는다").toBe(false);
    expect(isCalendarKey("Tab"), "탭은 격자를 빠져나가는 키다").toBe(false);
  });
});

describe("rovingDate — 격자에서 탭이 멈추는 칸 하나", () => {
  it("고른 날짜 → 오늘 → 첫 예약 가능일 순서", () => {
    expect(rovingDate("2026-10-01", "2026-10-20", "2026-10-05", B)).toBe("2026-10-20");
    expect(rovingDate("2026-10-01", null, "2026-10-05", B)).toBe("2026-10-05");
    expect(rovingDate("2026-10-01", null, "2026-09-20", B), "오늘이 이 달이 아니다").toBe("2026-10-01");
  });

  it("보고 있는 달 밖의 선택은 쓰지 않는다 — 없는 칸에 tabIndex 를 주면 탭이 격자를 건너뛴다", () => {
    expect(rovingDate("2026-11-01", "2026-10-20", "2026-10-05", { firstDate: "2026-10-01", lastDate: "2026-11-30" })).toBe("2026-11-01");
  });

  it("그 달에 예약 가능한 날이 하나도 없으면 1일에 둔다", () => {
    expect(rovingDate("2026-12-01", null, "2026-10-05", B)).toBe("2026-12-01");
  });
});
