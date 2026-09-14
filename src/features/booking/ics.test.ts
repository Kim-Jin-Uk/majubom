import { describe, expect, it } from "vitest";
import { buildIcs, fold, icsEscape, icsTime } from "./ics";

/**
 * 캘린더 파일은 **조용히 틀린다** — 깨진 .ics 는 오류를 내지 않고 그냥 안 열리거나,
 * 더 나쁘게는 한 시간 어긋난 일정으로 들어간다. 그래서 모양을 테스트로 고정한다.
 */
describe("icsTime", () => {
  it("UTC 순간을 구분자 없이 적는다", () => {
    expect(icsTime(Date.UTC(2026, 8, 20, 1, 0, 0))).toBe("20260920T010000Z");
  });
});

describe("icsEscape", () => {
  it("값 구분자와 겹치는 문자를 막는다", () => {
    // 이스케이프하지 않으면 쉼표 뒤가 통째로 다른 속성으로 읽힌다
    expect(icsEscape("봄 네일, 강남점; A\\B")).toBe("봄 네일\\, 강남점\\; A\\\\B");
    expect(icsEscape("첫 줄\n둘째 줄")).toBe("첫 줄\\n둘째 줄");
  });
});

describe("fold", () => {
  it("75옥텟이 넘지 않으면 그대로 둔다", () => {
    expect(fold("SUMMARY:짧다")).toBe("SUMMARY:짧다");
  });

  it("한글을 바이트로 세되 글자를 쪼개지 않는다", () => {
    const folded = fold(`SUMMARY:${"가".repeat(40)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    // 이어지는 줄은 공백 한 칸으로 시작한다
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    // 어느 줄도 75옥텟을 넘지 않는다
    expect(parts.every((p) => Buffer.byteLength(p, "utf8") <= 75)).toBe(true);
    // 글자가 반 토막 나지 않았다 — 접힌 것을 되돌리면 원문이다
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(`SUMMARY:${"가".repeat(40)}`);
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "ABC12345@majubom.kr",
    start: Date.UTC(2026, 8, 20, 1, 0),
    end: Date.UTC(2026, 8, 20, 2, 0),
    stamp: Date.UTC(2026, 8, 14, 0, 0),
    summary: "봄 네일 · 젤네일",
    location: "서울 강남구 테헤란로 1",
    description: "예약번호 ABC12345",
  });

  it("CRLF 로 끝나는 VCALENDAR 한 덩이다", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20260920T010000Z");
    expect(ics).toContain("DTEND:20260920T020000Z");
  });

  it("빈 값은 줄 자체를 넣지 않는다", () => {
    // `LOCATION:` 만 있는 빈 줄은 캘린더에 빈 장소가 찍힌다
    const bare = buildIcs({ uid: "x", start: 0, end: 1, stamp: 0, summary: "s" });
    expect(bare).not.toContain("LOCATION:");
    expect(bare).not.toContain("DESCRIPTION:");
  });
});
