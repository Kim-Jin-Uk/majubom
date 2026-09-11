import { describe, expect, it } from "vitest";
import { checkSlugInput, isTempSlug, slugSchema } from "./slug-rules";

describe("checkSlugInput — 저장 버튼이 왜 잠겼는지 말한다", () => {
  const TEMP = "b-voynlmu9";

  it("빈 칸은 나무라지 않는다 — 아직 입력 전이다", () => {
    expect(checkSlugInput("", TEMP)).toEqual({ canSave: false, reason: null });
    expect(checkSlugInput("   ", TEMP)).toEqual({ canSave: false, reason: null });
  });

  it("지금 쓰는 주소를 그대로 적으면 그렇다고 말한다 — 조용히 잠그면 이유를 알 수 없다", () => {
    const r = checkSlugInput(TEMP, TEMP);
    expect(r.canSave).toBe(false);
    expect(r.reason).toMatch(/임시 주소/);

    const r2 = checkSlugInput("bom-nail", "bom-nail");
    expect(r2.canSave).toBe(false);
    expect(r2.reason).toBe("지금 쓰는 주소예요");
  });

  it("b- 는 임시 주소 전용이라 새 주소로 쓸 수 없다", () => {
    const r = checkSlugInput("b-something", TEMP);
    expect(r.canSave).toBe(false);
    expect(r.reason).toMatch(/임시 주소 전용/);
  });

  it("예약어와 형식 위반도 각각 이유가 다르다", () => {
    expect(checkSlugInput("admin", TEMP)).toEqual({ canSave: false, reason: "이미 예약된 주소예요" });
    expect(checkSlugInput("ab", TEMP).reason).toMatch(/3~30자/);
    expect(checkSlugInput("-bom", TEMP).reason).toMatch(/하이픈/);
    expect(checkSlugInput("bom-", TEMP).reason).toMatch(/하이픈/);
  });

  it("멀쩡한 주소는 통과한다. 대문자·공백은 다듬어서 본다", () => {
    expect(checkSlugInput("bom-nail", TEMP)).toEqual({ canSave: true, reason: null });
    expect(checkSlugInput("  BOM-NAIL  ", TEMP)).toEqual({ canSave: true, reason: null });
  });

  it("화면 판정과 서버 스키마가 어긋나지 않는다 — 버튼이 켜지면 서버도 받는다", () => {
    for (const s of ["bom-nail", "a1b", "x".repeat(30), "my-salon-2"]) {
      expect(checkSlugInput(s, "other"), s).toEqual({ canSave: true, reason: null });
      expect(slugSchema.safeParse(s).success, s).toBe(true);
    }
    for (const s of ["b-x1", "ab", "-a", "a-", "x".repeat(31), "한글", "A B"]) {
      expect(checkSlugInput(s, "other").canSave, s).toBe(false);
    }
  });
});

describe("isTempSlug", () => {
  it("가입 때 붙는 b- 접두사만 임시다", () => {
    expect(isTempSlug("b-voynlmu9")).toBe(true);
    expect(isTempSlug("bom-nail")).toBe(false);
  });
});
