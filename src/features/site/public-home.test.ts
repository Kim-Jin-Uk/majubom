import { describe, expect, it } from "vitest";
import { maskName } from "./public-home";

describe("maskName", () => {
  it("가운데를 가린다", () => {
    expect(maskName("김진욱")).toBe("김*욱");
    expect(maskName("남궁민수")).toBe("남**수");
    expect(maskName("김공")).toBe("김*");
    expect(maskName("김")).toBe("김");
    expect(maskName(null)).toBe("익명");
    expect(maskName("  ")).toBe("익명");
  });
});
