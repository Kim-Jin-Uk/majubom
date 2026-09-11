import { describe, expect, it } from "vitest";
import { whenText } from "./notify-text";

const SEOUL = "Asia/Seoul";

describe("whenText", () => {
  it("가게 시각으로 읽는다 — 서버 시계(UTC)나 손님 기기 시간대가 아니다", () => {
    expect(whenText(new Date("2026-10-05T05:00:00Z"), new Date("2026-10-05T06:00:00Z"), SEOUL)).toBe("2026년 10월 5일 (월) 14:00 – 15:00");
  });

  it("자정을 넘기면 `익일` — 화면과 같은 규칙", () => {
    // 한국시각 23:30 – 익일 00:30
    expect(whenText(new Date("2026-10-05T14:30:00Z"), new Date("2026-10-05T15:30:00Z"), SEOUL)).toBe("2026년 10월 5일 (월) 23:30 – 익일 00:30");
  });

  it("해를 붙인다 — 메일은 몇 달 뒤 받은편지함에서 다시 열린다", () => {
    expect(whenText(new Date("2027-01-01T01:00:00Z"), new Date("2027-01-01T02:00:00Z"), SEOUL)).toMatch(/^2027년 1월 1일/);
  });

  it("타임존이 다르면 다른 문구가 나온다 — 사업장 타임존을 실제로 쓴다는 뜻", () => {
    const a = whenText(new Date("2026-10-05T05:00:00Z"), new Date("2026-10-05T06:00:00Z"), SEOUL);
    const b = whenText(new Date("2026-10-05T05:00:00Z"), new Date("2026-10-05T06:00:00Z"), "UTC");
    expect(b).not.toBe(a);
    expect(b).toBe("2026년 10월 5일 (월) 05:00 – 06:00");
  });
});
