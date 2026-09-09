import { describe, expect, it } from "vitest";
import { internalSitePath, isPublicHome } from "./routing";

describe("공개 홈 주소 규칙", () => {
  it("`/@{slug}` 를 내부 경로로 바꾼다", () => {
    expect(internalSitePath("/@spring-nail")).toBe("/site/spring-nail");
    expect(internalSitePath("/@abc")).toBe("/site/abc");
    expect(internalSitePath(`/@${"a".repeat(30)}`)).toBe(`/site/${"a".repeat(30)}`);
  });

  it("slug 모양이 아니면 rewrite 하지 않는다 — 경로 조작을 여기서 끊는다", () => {
    // new URL("/site/../admin", base) 는 "/admin" 으로 정규화된다. 공개 주소 한 줄로 내부 경로에 들어가는 길
    expect(internalSitePath("/@../admin")).toBeNull();
    expect(internalSitePath("/@..%2Fadmin")).toBeNull();
    expect(internalSitePath("/@shop/book")).toBeNull();
    expect(internalSitePath("/@")).toBeNull();
    expect(internalSitePath("/@ab"), "3자 미만").toBeNull();
    expect(internalSitePath(`/@${"a".repeat(31)}`), "30자 초과").toBeNull();
    expect(internalSitePath("/@Shop"), "대문자는 slug 가 아니다").toBeNull();
    expect(internalSitePath("/@sh op")).toBeNull();
  });

  it("공개 홈이 아닌 경로는 건드리지 않는다", () => {
    for (const p of ["/", "/login", "/console", "/api/reservations", "/site/spring-nail"]) {
      expect(isPublicHome(p), p).toBe(false);
      expect(internalSitePath(p), p).toBeNull();
    }
  });
});
