import { describe, it, expect } from "vitest";
import { buildObjectKey, MAX_IMAGE_BYTES } from "./r2";

const biz = "11111111-2222-4333-8444-555555555555";

describe("buildObjectKey", () => {
  it("kind/businessId/yyyy/mm/uuid.ext 형식", () => {
    const k = buildObjectKey("product", biz, "image/webp", new Date("2026-10-05T00:00:00Z"));
    expect(k).toMatch(new RegExp(`^product/${biz}/2026/10/[0-9a-f-]{36}\\.webp$`));
  });
  it("원본 파일명·개인정보가 키에 들어갈 여지가 없다 (uuid 만)", () => {
    const k = buildObjectKey("chat", biz, "image/jpeg");
    expect(k.split("/").pop()).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });
  it("businessId 가 uuid 가 아니면 거부 — 경로 조작 방지", () => {
    expect(() => buildObjectKey("product", "../etc", "image/png")).toThrow();
  });
  it("5MB 상한 상수", () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
