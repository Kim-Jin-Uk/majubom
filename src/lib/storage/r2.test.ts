import { describe, it, expect } from "vitest";
import { buildImageBase, BUSINESS_IMAGE_QUOTA_BYTES, MAX_IMAGE_BYTES } from "./r2";
import { parseImageUrl, variantKey } from "./variants";

const biz = "11111111-2222-4333-8444-555555555555";

describe("buildImageBase", () => {
  it("businessId/kind/yyyy/mm/uuid 형식 — 사업장이 맨 앞이라 용량 집계·삭제가 접두사 하나다", () => {
    const b = buildImageBase("product", biz, new Date("2026-10-05T00:00:00Z"));
    expect(b).toMatch(new RegExp(`^${biz}/product/2026/10/[0-9a-f-]{36}$`));
  });
  it("원본 파일명·개인정보가 키에 들어갈 여지가 없다 (uuid 만)", () => {
    expect(buildImageBase("chat", biz).split("/").pop()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("businessId 가 uuid 가 아니면 거부 — 경로 조작 방지", () => {
    expect(() => buildImageBase("product", "../etc")).toThrow();
  });
  it("만든 키를 다시 읽을 수 있다 — 저장 쪽과 화면 쪽 규약이 같은 것이어야 한다", () => {
    const key = variantKey(buildImageBase("gallery", biz), 640);
    expect(parseImageUrl(key)).toMatchObject({ kind: "gallery", width: 640 });
  });
  it("한도 상수", () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(BUSINESS_IMAGE_QUOTA_BYTES).toBe(100 * 1024 * 1024);
  });
});
