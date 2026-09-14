import { describe, expect, it } from "vitest";
import { endOfDayExclusive, nextCursorOf, parseCursor, startOfDay } from "./audit";

/**
 * 감사 로그 조회에서 실수하기 쉬운 두 곳 — **커서**와 **끝 날짜**.
 *
 * 감사 로그는 배치가 한 번에 수백 건을 **같은 시각**으로 적재한다. 커서가 시각만 보면 그 경계에서
 * 행이 빠지거나 겹치는데, 둘 다 조사에서 치명적이다(없는 일을 없다고 읽거나 같은 일을 두 번 센다).
 */
describe("parseCursor", () => {
  it("시각과 id 를 함께 읽는다", () => {
    const c = parseCursor("2026-09-14T03:00:00.000Z|abc");
    expect(c?.at.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(c?.id).toBe("abc");
  });

  it("없으면 null — 첫 페이지다", () => {
    expect(parseCursor(undefined)).toBeNull();
  });

  it("id 가 없거나 시각이 깨졌으면 던진다 — 조용히 첫 페이지로 돌아가면 조사자가 눈치채지 못한다", () => {
    for (const bad of ["2026-09-14T03:00:00.000Z", "notadate|abc", "|abc", "2026-09-14T03:00:00.000Z|"]) {
      expect(() => parseCursor(bad), bad).toThrow();
    }
  });
});

describe("nextCursorOf", () => {
  const row = (iso: string, id: string) => ({ at: new Date(iso), id });

  it("더 읽을 것이 없으면 null", () => {
    expect(nextCursorOf([row("2026-09-14T00:00:00.000Z", "a")], 50)).toBeNull();
    expect(nextCursorOf([], 50)).toBeNull();
  });

  it("한 건 더 읽혔으면 **페이지의 마지막** 행을 커서로 준다 — 초과분이 아니다", () => {
    const rows = [row("2026-09-14T00:00:02.000Z", "c"), row("2026-09-14T00:00:01.000Z", "b"), row("2026-09-14T00:00:00.000Z", "a")];
    // 2건짜리 페이지 + 초과 1건 → 커서는 두 번째 행("b")이어야 다음 페이지가 "a" 부터 시작한다
    expect(nextCursorOf(rows, 2)).toBe("2026-09-14T00:00:01.000Z|b");
  });

  it("같은 시각이 이어져도 id 가 함께 있어 경계가 갈린다", () => {
    const same = "2026-09-14T00:00:00.000Z";
    const rows = [row(same, "c"), row(same, "b"), row(same, "a")];
    expect(nextCursorOf(rows, 2)).toBe(`${same}|b`);
  });
});

describe("기간 경계", () => {
  // 운영자가 고른 "9월 14일" 은 한국 시각의 하루다. UTC 로 자르면 그날 오전 9시 이전이 통째로 빠지고
  // 다음 날 새벽이 섞여 든다 — 조사에서 "그날 아침에 아무 일도 없었다" 로 읽힌다
  it("시작은 KST 자정이다", () => {
    expect(startOfDay("2026-09-14").toISOString()).toBe("2026-09-13T15:00:00.000Z");
  });

  it("그날을 포함하려면 다음 KST 자정 미만이어야 한다", () => {
    expect(endOfDayExclusive("2026-09-14").toISOString()).toBe("2026-09-14T15:00:00.000Z");
  });
});
