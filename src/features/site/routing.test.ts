import { describe, expect, it } from "vitest";
import { bookingHref, internalSitePath, isPublicHome, isPublicPath } from "./routing";

describe("공개 주소 규칙", () => {
  it("`/@{slug}` 를 내부 경로로 바꾼다", () => {
    expect(internalSitePath("/@spring-nail")).toBe("/site/spring-nail");
    expect(internalSitePath("/@abc")).toBe("/site/abc");
    expect(internalSitePath(`/@${"a".repeat(30)}`)).toBe(`/site/${"a".repeat(30)}`);
  });

  it("slug 뒤의 경로도 따라간다 — 예약 위젯이 `/@{slug}/book` 이다", () => {
    expect(internalSitePath("/@spring-nail/book")).toBe("/site/spring-nail/book");
    expect(internalSitePath("/@spring-nail/book/")).toBe("/site/spring-nail/book");
    expect(internalSitePath("/@spring-nail/")).toBe("/site/spring-nail");
  });

  it("slug 모양이 아니면 rewrite 하지 않는다 — 경로 조작을 여기서 끊는다", () => {
    // new URL("/site/../admin", base) 는 "/admin" 으로 정규화된다. 공개 주소 한 줄로 내부 경로에 들어가는 길
    expect(internalSitePath("/@../admin")).toBeNull();
    expect(internalSitePath("/@..%2Fadmin")).toBeNull();
    expect(internalSitePath("/@")).toBeNull();
    expect(internalSitePath("/@ab"), "3자 미만").toBeNull();
    expect(internalSitePath(`/@${"a".repeat(31)}`), "30자 초과").toBeNull();
    expect(internalSitePath("/@Shop"), "대문자는 slug 가 아니다").toBeNull();
    expect(internalSitePath("/@sh op")).toBeNull();
  });

  it("뒤 조각에도 점을 허용하지 않는다 — `..` 이 만들어질 여지를 남기지 않는다", () => {
    expect(internalSitePath("/@shop/../admin")).toBeNull();
    expect(internalSitePath("/@shop/.")).toBeNull();
    expect(internalSitePath("/@shop/a.b")).toBeNull();
    expect(internalSitePath("/@shop//book"), "빈 조각").toBeNull();
  });

  it("공유 캐시에 올릴 수 있는 것은 홈 한 장뿐이다", () => {
    expect(isPublicHome("/@spring-nail")).toBe(true);
    expect(isPublicHome("/@spring-nail/")).toBe(true);
    // 위젯은 로그인 여부에 따라 달라진다 — 공유 캐시에 올리면 남의 화면이 배달된다
    expect(isPublicHome("/@spring-nail/book")).toBe(false);
    expect(isPublicPath("/@spring-nail/book")).toBe(true);
  });

  it("공개 주소가 아닌 경로는 건드리지 않는다", () => {
    for (const p of ["/", "/login", "/console", "/api/reservations", "/site/spring-nail"]) {
      expect(isPublicPath(p), p).toBe(false);
      expect(isPublicHome(p), p).toBe(false);
      expect(internalSitePath(p), p).toBeNull();
    }
  });

  it("예약 위젯 주소", () => {
    expect(bookingHref("spring-nail")).toBe("/@spring-nail/book");
    expect(bookingHref("spring-nail", "abc-123")).toBe("/@spring-nail/book?product=abc-123");
  });
});
