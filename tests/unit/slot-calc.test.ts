/**
 * FR-BOOK-010 가용 슬롯 계산 — 테스트 골격 (이슈 1-12).
 *
 * 구현(이슈 7-1·7-2)이 없으므로 40건은 `it.todo`로 등록만 한다.
 * 지금 실제로 통과해야 하는 것은 픽스처 자체의 무결성이다:
 *   (1) 정확히 40건이고 id가 유일하다
 *   (2) 모든 케이스가 slot-types.ts 타입(zod 스키마)에 맞는다
 *   (3) 태그 분포 최소치를 만족한다
 *   (+) 픽스처 내부 일관성 — 시각 오프셋, 정렬, FIXED/FREE 출력 형태, 명세 20석 예시 포함
 *
 * 구현이 들어오면 `it.todo` 를 아래 형태로 바꾼다:
 *   it(`${id} ${title}`, () => expect(computeSlots(ctx, query)).toEqual(expected));
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSlotFailure } from "@/features/booking/slot-types";
import { slotCasesFile, type CaseTag, type SlotCase } from "./slot-fixture.schema";

const FIXTURE_PATH = fileURLToPath(new URL("../fixtures/slot-cases.json", import.meta.url));
const raw: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

/** 스키마 검증 전에 골격 등록에 필요한 최소 정보만 느슨하게 읽는다 (검증 실패는 아래 테스트가 잡는다) */
const rawCases = ((raw as { cases?: unknown }).cases ?? []) as Array<{ id: string; title: string }>;

/** 태그 분포 최소치 — 이슈 1-12 요구사항 */
const MIN_TAG_COUNT: Partial<Record<CaseTag, number>> = {
  midnight: 5,
  shared: 4,
  fixed: 6,
  buffer: 5,
  "capacity-n": 5,
  closure: 5,
  "duration-options": 3,
  "resource-assign": 3,
  boundary: 4,
};

describe("slot-cases.json 픽스처 무결성", () => {
  const parsed = slotCasesFile.safeParse(raw);

  it("(2) 모든 케이스가 slot-types.ts 타입(zod 스키마)에 맞는다", () => {
    if (!parsed.success) {
      // 어떤 케이스의 어떤 필드가 틀렸는지 바로 보이게 한다
      const lines = parsed.error.issues.map((i) => {
        const caseIdx = i.path[0] === "cases" ? Number(i.path[1]) : NaN;
        const id = Number.isNaN(caseIdx) ? "(file)" : rawCases[caseIdx]?.id ?? `#${caseIdx}`;
        return `${id} ${i.path.slice(2).join(".")}: ${i.message}`;
      });
      expect.fail(`픽스처 스키마 위반 ${lines.length}건\n${lines.join("\n")}`);
    }
    expect(parsed.success).toBe(true);
  });

  const cases: SlotCase[] = parsed.success ? parsed.data.cases : [];

  it("(1) 정확히 40건이고 id가 유일하며 S01..S40 순서다", () => {
    expect(cases).toHaveLength(40);
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(40);
    expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`));
  });

  it("(3) 태그 분포 최소치를 만족한다", () => {
    const count: Partial<Record<CaseTag, number>> = {};
    for (const c of cases) for (const t of c.tags) count[t] = (count[t] ?? 0) + 1;
    const short = Object.entries(MIN_TAG_COUNT)
      .filter(([tag, min]) => (count[tag as CaseTag] ?? 0) < (min ?? 0))
      .map(([tag, min]) => `${tag}: ${count[tag as CaseTag] ?? 0} < ${min}`);
    expect(short, `태그 부족: ${short.join(", ")}`).toEqual([]);
  });

  it("모든 시각은 Asia/Seoul 오프셋(+09:00)을 가진 ISO 8601 이다", () => {
    const offending: string[] = [];
    const visit = (v: unknown, path: string) => {
      if (typeof v === "string") {
        if (/^\d{4}-\d{2}-\d{2}T/.test(v) && !v.endsWith("+09:00")) offending.push(`${path}=${v}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, `${path}.${k}`);
    };
    for (const c of cases) visit({ ctx: c.ctx, expected: c.expected }, c.id);
    expect(offending).toEqual([]);
  });

  it("성공 케이스의 슬롯은 start 오름차순이고 시작 시각이 중복되지 않는다 (mergeByStartTime 결과)", () => {
    for (const c of cases) {
      if (isSlotFailure(c.expected)) continue;
      const starts = c.expected.slots.map((s) => Date.parse(s.start));
      const sorted = [...starts].sort((a, b) => a - b);
      expect(starts, `${c.id} 정렬`).toEqual(sorted);
      expect(new Set(starts).size, `${c.id} 시작 시각 중복`).toBe(starts.length);
    }
  });

  it("슬롯 길이는 확정된 이용 시간(query.durationMin ?? product.durationMin)과 같다", () => {
    for (const c of cases) {
      if (isSlotFailure(c.expected)) continue;
      const dur = (c.query.durationMin ?? c.ctx.product.durationMin) * 60_000;
      for (const s of [...c.expected.slots, ...(c.expected.excluded ?? [])]) {
        expect(Date.parse(s.end) - Date.parse(s.start), `${c.id} ${s.start}`).toBe(dur);
      }
    }
  });

  it("슬롯의 resourceIds 는 상품에 연결된 활성 자원이고, 잔여는 요구 좌석 이상이다 (정원 1 슬롯은 팀 단위 — README 가정 A1)", () => {
    for (const c of cases) {
      if (isSlotFailure(c.expected)) continue;
      const active = new Set(c.ctx.resources.filter((r) => r.isActive).map((r) => r.id));
      // cap = min(capacityPerSlot, resource.capacity). cap 이 1 이면 한 팀이 슬롯을 통째로 쓰므로 요구 좌석은 1
      const minResourceCap = Math.min(...c.ctx.resources.filter((r) => r.isActive).map((r) => r.capacity));
      const cap = Math.min(c.ctx.product.capacityPerSlot, minResourceCap);
      const needed = cap === 1 ? 1 : c.query.partySize;
      for (const s of c.expected.slots) {
        for (const rid of s.resourceIds) {
          expect(c.ctx.product.resourceIds, `${c.id} ${rid} 연결`).toContain(rid);
          expect(active.has(rid), `${c.id} ${rid} 활성`).toBe(true);
          if (c.query.resourceId) expect(rid).toBe(c.query.resourceId);
        }
        expect(s.remaining, `${c.id} ${s.start} 잔여`).toBeGreaterThanOrEqual(needed);
      }
    }
  });

  it("FIXED 상품 케이스만 excluded 를 가지며, 제외 회차는 슬롯과 (start, resourceId)가 겹치지 않는다", () => {
    for (const c of cases) {
      if (isSlotFailure(c.expected)) continue;
      const isFixed = c.ctx.product.startMode === "FIXED";
      // 정책(날짜 범위) 0단계에서 잘린 경우는 excluded 를 채울 회차 자체가 없다
      const emptyByPolicy = c.expected.slots.length === 0 && c.expected.excluded === undefined;
      if (isFixed && !emptyByPolicy) expect(c.expected.excluded, `${c.id} FIXED 는 excluded 필수`).toBeDefined();
      if (!isFixed) expect(c.expected.excluded, `${c.id} FREE 는 excluded 없음`).toBeUndefined();

      const slotKeys = new Set(c.expected.slots.flatMap((s) => s.resourceIds.map((r) => `${s.start}|${r}`)));
      for (const e of c.expected.excluded ?? []) {
        expect(slotKeys.has(`${e.start}|${e.resourceId}`), `${c.id} ${e.start} 슬롯과 제외 동시 존재`).toBe(false);
        if (e.reason === "FULL") {
          expect(e.remaining, `${c.id} FULL 은 remaining 포함`).toBeDefined();
          expect(e.remaining ?? 0).toBeLessThan(c.query.partySize);
        }
      }
    }
  });

  it("오류 케이스는 error 태그를 갖고, 반대로 error 태그면 오류 케이스다", () => {
    for (const c of cases) {
      expect(isSlotFailure(c.expected), `${c.id}`).toBe(c.tags.includes("error"));
    }
  });

  it("명세의 20석 예시(10–11시 10명 + 11–12시 10명, 10:30–11:30 5명 성립)가 포함돼 있다", () => {
    const hit = cases.find((c) => {
      if (isSlotFailure(c.expected)) return false;
      const twenty = c.ctx.resources.some((r) => r.capacity === 20);
      const tens = c.ctx.existingReservations.filter((r) => r.partySize === 10);
      const s1030 = c.expected.slots.find((s) => s.start.endsWith("T10:30:00+09:00"));
      return twenty && tens.length === 2 && c.query.partySize === 5 && s1030?.remaining === 10;
    });
    expect(hit?.id).toBe("S10");
    // 같은 조건에서 15명은 10:30 이 빠진다
    const fifteen = cases.find((c) => c.id === "S11");
    expect(fifteen && !isSlotFailure(fifteen.expected) && fifteen.expected.slots.some((s) => s.start.endsWith("T10:30:00+09:00"))).toBe(false);
  });
});

describe("FR-BOOK-010 computeSlots — 40건 (구현 전, todo)", () => {
  // 구현이 들어오면 it.todo 를 it 로 바꾸고 computeSlots(ctx, query) 와 expected 를 toEqual 로 비교한다.
  describe.each(rawCases.map((c) => [c.id, c.title] as const))("%s", (id, title) => {
    it.todo(`${id} ${title}`);
  });
});
