import { describe, expect, it } from "vitest";
import { hourText } from "./hours";

/**
 * 영업시간 문구. 영업일 규약(`close ≤ open` 이면 익일, 같으면 24시간)을 화면 글자로 옮기는 자리라
 * 그대로 찍으면 심야 영업이 거꾸로 읽히고 24시간 영업이 휴무로 읽힌다.
 */
describe("hourText", () => {
  it("보통 영업", () => {
    expect(hourText({ open: "09:00", close: "18:00" })).toBe("09:00 – 18:00");
  });

  it("자정을 넘기면 익일이라고 말한다 — `20:00 – 02:00` 은 거꾸로 읽힌다", () => {
    expect(hourText({ open: "20:00", close: "02:00" })).toBe("20:00 – 익일 02:00");
    expect(hourText({ open: "23:00", close: "07:00" })).toBe("23:00 – 익일 07:00");
  });

  it("open === close 는 24시간 영업이다 — `00:00 – 00:00` 은 휴무로 읽힌다", () => {
    expect(hourText({ open: "00:00", close: "00:00" })).toBe("24시간 영업");
    expect(hourText({ open: "10:00", close: "10:00" })).toBe("24시간 영업");
  });

  it("휴게 시간을 덧붙인다", () => {
    expect(hourText({ open: "09:00", close: "18:00", breaks: [{ start: "12:00", end: "13:00" }] })).toBe("09:00 – 18:00 (휴게 12:00–13:00)");
    expect(hourText({ open: "20:00", close: "02:00", breaks: [{ start: "23:30", end: "00:30" }] })).toBe("20:00 – 익일 02:00 (휴게 23:30–00:30)");
  });
});
