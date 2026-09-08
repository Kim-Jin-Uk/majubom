import { describe, expect, it } from "vitest";
import { resourceInputSchema } from "./resources";

describe("resourceInputSchema (FR-RES-010)", () => {
  const base = { type: "STAFF", name: "김디자이너", capacity: 1 };
  it("이미지는 http(s) URL 만 — javascript:/data: 는 거절", () => {
    expect(resourceInputSchema.safeParse({ ...base, imageUrl: "https://cdn.example.com/a.jpg" }).success).toBe(true);
    expect(resourceInputSchema.safeParse({ ...base, imageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, imageUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
  });
  it("imageUrl 생략은 undefined(유지), null 은 제거", () => {
    expect(resourceInputSchema.parse(base).imageUrl).toBeUndefined();
    expect(resourceInputSchema.parse({ ...base, imageUrl: null }).imageUrl).toBeNull();
  });
  it("정원 1~500, 타입은 셋 중 하나", () => {
    expect(resourceInputSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, capacity: 501 }).success).toBe(false);
    expect(resourceInputSchema.safeParse({ ...base, type: "ROOM" }).success).toBe(false);
  });
});
