import { describe, expect, it } from "vitest";
import { IMAGE_KINDS, IMAGE_WIDTHS, imageSrcSet, parseImageUrl, plannedWidths, siblingWidths, variantKey, type ImageKind } from "./variants";

const biz = "11111111-2222-4333-8444-555555555555";
const uid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const base = `https://pub-x.r2.dev/${biz}/product/2026/10/${uid}`;

describe("plannedWidths", () => {
  it("원본보다 큰 폭은 만들지 않는다 — 확대는 화질만 버린다", () => {
    expect(plannedWidths("product", 700)).toEqual([320, 640, 700]);
  });
  it("원본이 아주 크면 그 kind 의 상한에서 멈춘다", () => {
    expect(plannedWidths("product", 4000)).toEqual([320, 640, 1280]);
    expect(plannedWidths("cover", 4000)).toEqual([640, 1280, 1920]);
  });
  it("표준 폭과 정확히 같으면 한 장만 — 같은 그림을 두 이름으로 저장하지 않는다", () => {
    expect(plannedWidths("product", 320)).toEqual([320]);
    expect(plannedWidths("product", 1280)).toEqual([320, 640, 1280]);
  });
  it("아주 작은 원본도 최소 한 장은 나온다", () => {
    expect(plannedWidths("logo", 40)).toEqual([40]);
  });
});

describe("plannedWidths ↔ siblingWidths 왕복", () => {
  /**
   * 이 왕복이 이 파일의 존재 이유다. 저장하는 건 가장 큰 URL 하나뿐이라, 화면이 srcSet 을 만들 때
   * **없는 파일을 가리키면 404 가 뜬다**. 한쪽 규칙만 고치는 순간 그렇게 된다.
   */
  it("어떤 원본 폭이든, 저장된(가장 큰) URL 에서 만들어진 폭 전부를 되찾는다", () => {
    for (const kind of IMAGE_KINDS as readonly ImageKind[]) {
      for (const srcW of [1, 40, 127, 128, 321, 640, 641, 1279, 1280, 1921, 6000]) {
        const made = plannedWidths(kind, srcW);
        const stored = made[made.length - 1];
        expect(siblingWidths(kind, stored), `${kind} @${srcW}`).toEqual(made);
      }
    }
  });
});

describe("parseImageUrl", () => {
  it("사업장 · kind · 폭을 갈라 낸다", () => {
    expect(parseImageUrl(`${base}/640.webp`)).toEqual({ base, kind: "product", width: 640 });
  });
  it("사업자가 붙여 넣은 외부 URL 은 건드리지 않는다", () => {
    for (const u of ["https://example.com/photo.jpg", `${base}/640.jpg`, `https://pub-x.r2.dev/${biz}/nope/2026/10/${uid}/640.webp`, "https://pub-x.r2.dev/640.webp"]) {
      expect(parseImageUrl(u), u).toBeNull();
    }
  });
});

describe("imageSrcSet", () => {
  it("함께 만들어진 폭을 전부 후보로 준다", () => {
    const { src, srcSet } = imageSrcSet(`${base}/1280.webp`);
    expect(src).toBe(`${base}/1280.webp`);
    expect(srcSet).toBe(`${base}/320.webp 320w, ${base}/640.webp 640w, ${base}/1280.webp 1280w`);
  });
  it("한 장뿐이면 srcSet 을 붙이지 않는다 — 후보가 하나인 srcSet 은 바이트만 늘린다", () => {
    expect(imageSrcSet(`${base}/200.webp`).srcSet).toBeUndefined();
  });
  it("우리 것이 아닌 URL 은 그대로 통과시킨다", () => {
    expect(imageSrcSet("https://example.com/a.png")).toEqual({ src: "https://example.com/a.png" });
  });
});

describe("규약", () => {
  it("표준 폭은 오름차순이어야 한다 — 마지막을 상한으로 쓴다", () => {
    for (const kind of IMAGE_KINDS as readonly ImageKind[]) {
      const ws = IMAGE_WIDTHS[kind];
      expect([...ws].sort((a, b) => a - b), kind).toEqual([...ws]);
      expect(ws.length, kind).toBeGreaterThan(0);
    }
  });
  it("variantKey 는 base 뒤에 폭만 붙인다", () => {
    expect(variantKey(base, 320)).toBe(`${base}/320.webp`);
  });
});
