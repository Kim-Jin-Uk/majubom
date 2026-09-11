import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkDeclaredSize, ImageError, MAX_IMAGE_BYTES, processImage, sniffMime } from "./image";

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#2f6f4f" } });
const jpeg = (w: number, h: number) => solid(w, h).jpeg().toBuffer();

describe("sniffMime", () => {
  it("바이트 앞머리로 형식을 정한다 — file.type 은 파일명에서 추측한 값이라 믿을 수 없다", async () => {
    expect(sniffMime(await solid(20, 20).jpeg().toBuffer())).toBe("image/jpeg");
    expect(sniffMime(await solid(20, 20).png().toBuffer())).toBe("image/png");
    expect(sniffMime(await solid(20, 20).webp().toBuffer())).toBe("image/webp");
    expect(sniffMime(await solid(20, 20).avif().toBuffer())).toBe("image/avif");
  });
  it("이미지가 아닌 것은 거부한다 — presign 시절엔 image/webp 로 서명받고 HTML 을 올릴 수 있었다", () => {
    expect(sniffMime(new TextEncoder().encode("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("processImage", () => {
  it("kind 의 표준 폭으로 webp 를 만든다", async () => {
    const r = await processImage(await jpeg(2000, 1000), "product");
    expect(r.variants.map((v) => v.width)).toEqual([320, 640, 1280]);
    for (const v of r.variants) {
      const m = await sharp(v.body).metadata();
      expect(m.format).toBe("webp");
      expect(m.width).toBe(v.width);
      expect(m.height).toBe(v.width / 2); // 비율 유지 — 자르지 않는다
    }
  });

  it("원본보다 크게 만들지 않는다", async () => {
    const r = await processImage(await jpeg(500, 500), "product");
    expect(r.variants.map((v) => v.width)).toEqual([320, 500]);
  });

  /**
   * 이 두 가지가 "원본을 보관하지 않는다" 는 결정의 값이다. 손님이 올린 리뷰 사진의 EXIF 에는
   * 촬영 위치가 들어 있고, 폰 사진은 EXIF 회전값 없이는 눕는다.
   */
  it("EXIF 를 남기지 않는다 — 리뷰 사진의 GPS 가 공개 URL 로 나가면 안 된다", async () => {
    const withExif = await solid(400, 200).withMetadata({ orientation: 1 }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const r = await processImage(withExif, "product");
    for (const v of r.variants) expect((await sharp(v.body).metadata()).exif).toBeUndefined();
  });

  it("EXIF 회전은 적용한다 — 버리기만 하면 세로로 찍은 사진이 눕는다", async () => {
    // orientation 6 = 시계방향 90도. 픽셀은 800×400 이지만 실제로는 400×800 세로 사진이다
    const rotated = await solid(800, 400).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await processImage(rotated, "product");
    expect(r.sourceWidth).toBe(400);
    expect(r.sourceHeight).toBe(800);
    const m = await sharp(r.variants[0].body).metadata();
    expect(m.width, "폭이 높이보다 크면 그림이 누운 것이다").toBeLessThan(m.height!);
  });

  it("이미지가 아니면 BAD_TYPE, 5MB 를 넘으면 TOO_LARGE", async () => {
    await expect(processImage(new TextEncoder().encode("not an image at all, really"), "product")).rejects.toThrow(ImageError);
    await expect(processImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "product")).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("앞머리만 이미지인 파일은 디코딩에서 걸린다", async () => {
    const fake = new Uint8Array(64);
    fake.set([0xff, 0xd8, 0xff, 0xe0], 0);
    await expect(processImage(fake, "product")).rejects.toMatchObject({ code: "UNREADABLE" });
  });

  it("kind 마다 폭 세트가 다르다 — 로고를 1280 으로 저장하지 않는다", async () => {
    expect((await processImage(await jpeg(3000, 3000), "logo")).variants.map((v) => v.width)).toEqual([128, 256]);
    expect((await processImage(await jpeg(3000, 3000), "cover")).variants.map((v) => v.width)).toEqual([640, 1280, 1920]);
  });
});

describe("압축 폭탄", () => {
  it("픽셀 수 상한을 넘는 원본은 UNREADABLE 로 거절한다 — 5MB png 로 1억 픽셀을 만들 수 있다", async () => {
    // 8000×6000 = 4800만 픽셀 > MAX_SOURCE_PIXELS(4000만). 단색이라 파일 자체는 작다
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_IMAGE_BYTES);
    await expect(processImage(bomb, "product")).rejects.toMatchObject({ code: "UNREADABLE" });
  });
});

describe("checkDeclaredSize — 몸통을 읽기 전 판정", () => {
  const OVER = String(MAX_IMAGE_BYTES + 64 * 1024 + 1);

  it("길이를 말하지 않은 요청은 통과가 아니라 거부다 — 청크 전송으로 5MB 가드를 지나갈 수 있었다", () => {
    expect(checkDeclaredSize(null)).toBe("missing");
    expect(checkDeclaredSize("")).toBe("missing");
    expect(checkDeclaredSize("0")).toBe("missing");
  });

  it("10진 숫자가 아닌 값도 없는 것으로 본다 — Number() 로 읽으면 NaN 이 비교를 전부 통과한다", () => {
    for (const bogus of ["abc", "1e10", " 5", "5 ", "+5", "-1", "5.5", "0x10"]) {
      expect(checkDeclaredSize(bogus), bogus).toBe("missing");
    }
  });

  it("한도는 파일 5MB + multipart 여유분이다", () => {
    expect(checkDeclaredSize("1")).toBe("ok");
    expect(checkDeclaredSize(String(MAX_IMAGE_BYTES))).toBe("ok");
    expect(checkDeclaredSize(String(MAX_IMAGE_BYTES + 64 * 1024))).toBe("ok");
    expect(checkDeclaredSize(OVER)).toBe("too-large");
  });
});
