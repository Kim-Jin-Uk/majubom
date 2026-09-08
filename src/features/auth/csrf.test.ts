import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "./csrf";
import { HttpError } from "./errors";

function req(method: string, headers: Record<string, string>) {
  return new Request("https://majubom.kr/api/x", { method, headers });
}

describe("assertSameOrigin", () => {
  it("GET 은 항상 통과", () => {
    expect(() => assertSameOrigin(req("GET", { "sec-fetch-site": "cross-site" }))).not.toThrow();
  });
  it("Sec-Fetch-Site same-origin/none 통과, cross-site·same-site 거부", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "none" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "cross-site" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-site" }))).toThrow(HttpError);
  });
  it("헤더 없으면 Origin ↔ Host 비교", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://majubom.kr", host: "majubom.kr" }))).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example", host: "majubom.kr" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(req("POST", { host: "majubom.kr" }))).toThrow(HttpError);
  });
});
