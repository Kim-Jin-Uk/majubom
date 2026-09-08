import { describe, expect, it } from "vitest";
import { pgCode } from "./errors";

describe("pgCode — drizzle 가 감싼 pg 오류 코드 읽기", () => {
  it("직접 code · cause.code 둘 다 읽는다", () => {
    expect(pgCode({ code: "23505" })).toBe("23505");
    expect(pgCode(Object.assign(new Error("Failed query"), { cause: { code: "23503" } }))).toBe("23503");
    expect(pgCode(new Error("x"))).toBeUndefined();
    expect(pgCode(null)).toBeUndefined();
  });
});
