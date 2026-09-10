import { describe, expect, it } from "vitest";
import type { WidgetProduct } from "./data";
import { ANY_RESOURCE, change, durationChoices, readSelection, resourcePick, selectionQuery, stepOf, type Selection } from "./state";

const base = { description: null, images: [], priceDisplay: null, capacityPerSlot: 1 };
const R = (id: string, name: string): WidgetProduct["resources"][number] => ({ id, name, type: "STAFF", capacity: 1 });

/** 담당자형 — 상품만 고르면 1단계 끝, 담당자는 시간 뒤 */
const staff: WidgetProduct = { ...base, id: "p-staff", name: "젤네일", startMode: "FREE", durationMin: 60, durationOptions: null, maxPartySize: 1, resourceSelectMode: "OPTIONAL", preset: "staff", resources: [R("r1", "봄"), R("r2", "여름")] };
/** 공간형 — 이용 시간과 공간을 1단계에서 */
const space: WidgetProduct = { ...base, id: "p-space", name: "스터디룸", startMode: "FREE", durationMin: 60, durationOptions: [60, 120, 240], maxPartySize: 4, resourceSelectMode: "REQUIRED", preset: "space", resources: [{ id: "s1", name: "A룸", type: "SPACE", capacity: 1 }] };
/** 수업형 — 인원만, 담당자 단계 없음 */
const klass: WidgetProduct = { ...base, id: "p-class", name: "하타요가", startMode: "FIXED", durationMin: 60, durationOptions: null, maxPartySize: 3, capacityPerSlot: 15, resourceSelectMode: "NONE", preset: "class", resources: [{ id: "c1", name: "강사 봄", type: "SHARED", capacity: 15 }] };
const all = [staff, space, klass];

const sel = (o: Partial<Selection>): Selection => ({ productId: null, durationMin: null, partySize: 1, resourceId: null, date: null, startAt: null, ...o });
const T = "2026-10-01T10:00:00+09:00";

describe("유형별 변형 (명세 FR-SITE-020 표)", () => {
  it("담당자를 어디서 고르는가", () => {
    expect(resourcePick(staff)).toBe("step4");
    expect(resourcePick(space), "슬롯 조회의 입력이라 1단계다").toBe("step1");
    expect(resourcePick(klass)).toBe("none");
  });

  it("이용 시간 선택지", () => {
    expect(durationChoices(staff)).toEqual([60]);
    expect(durationChoices(space)).toEqual([60, 120, 240]);
  });
});

describe("stepOf — 단계는 저장하지 않고 선택에서 유도한다", () => {
  it("담당자형: 상품 → 날짜 → 시간 → 담당자", () => {
    expect(stepOf(sel({}), null)).toBe(1);
    expect(stepOf(sel({ productId: staff.id, durationMin: 60 }), staff)).toBe(2);
    expect(stepOf(sel({ productId: staff.id, durationMin: 60, date: "2026-10-01" }), staff)).toBe(3);
    expect(stepOf(sel({ productId: staff.id, durationMin: 60, date: "2026-10-01", startAt: T }), staff)).toBe(4);
    expect(stepOf(sel({ productId: staff.id, durationMin: 60, date: "2026-10-01", startAt: T, resourceId: ANY_RESOURCE }), staff), "상관없음도 고른 것이다").toBe(5);
  });

  it("공간형: 이용 시간과 공간을 다 골라야 1단계가 끝난다", () => {
    expect(stepOf(sel({ productId: space.id }), space)).toBe(1);
    expect(stepOf(sel({ productId: space.id, durationMin: 120 }), space), "공간이 없으면 슬롯 조회가 400 이다").toBe(1);
    expect(stepOf(sel({ productId: space.id, durationMin: 120, resourceId: "s1" }), space)).toBe(2);
  });

  it("수업형: 담당자 단계를 건너뛴다", () => {
    expect(stepOf(sel({ productId: klass.id, durationMin: 60, date: "2026-10-01", startAt: T }), klass)).toBe(5);
  });
});

describe("readSelection — 모르는 값은 조용히 버리고, 뒤따르는 것도 같이 버린다", () => {
  const read = (q: string) => readSelection(new URLSearchParams(q), all);

  it("없는 상품이면 통째로 초기 상태다 — '3단계인데 상품이 없다' 가 생기지 않게", () => {
    expect(read("product=nope&d=2026-10-01&t=" + encodeURIComponent(T))).toEqual(sel({}));
    expect(read("")).toEqual(sel({}));
  });

  it("선택지에 없는 이용 시간·인원은 기본값으로 돌아간다", () => {
    expect(read("product=p-space&dur=90").durationMin, "90분은 선택지에 없다").toBeNull();
    expect(read("product=p-space&dur=120").durationMin).toBe(120);
    expect(read("product=p-class&party=99").partySize, "최대 3명").toBe(1);
    expect(read("product=p-class&party=2").partySize).toBe(2);
    expect(read("product=p-staff&party=2").partySize, "인원을 안 받는 상품").toBe(1);
  });

  it("1단계가 안 끝났으면 날짜·시각을 버린다", () => {
    const r = read(`product=p-space&d=2026-10-01&t=${encodeURIComponent(T)}`);
    expect(r.date, "이용 시간·공간이 없으면 그 슬롯이 계산된 적 없다").toBeNull();
    expect(r.startAt).toBeNull();
  });

  it("시각만 있고 날짜가 없으면 버린다", () => {
    expect(read(`product=p-staff&t=${encodeURIComponent(T)}`).startAt).toBeNull();
  });

  it("모양이 아닌 시각은 버린다 — 손으로 고친 주소가 예약 생성까지 흘러가지 않게", () => {
    for (const t of ["2026-10-01", "지금", "2026-10-01T10:00:00", "'; drop"]) {
      expect(read(`product=p-staff&d=2026-10-01&t=${encodeURIComponent(t)}`).startAt, t).toBeNull();
    }
    expect(read(`product=p-staff&d=2026-10-01&t=${encodeURIComponent("2026-10-01T10:00:00Z")}`).startAt).toBe("2026-10-01T10:00:00Z");
  });

  it("자정을 넘긴 영업일의 새벽 슬롯은 버리지 않는다", () => {
    const dawn = "2026-10-02T01:00:00+09:00";
    expect(read(`product=p-staff&d=2026-10-01&t=${encodeURIComponent(dawn)}`).startAt, "영업일 10-01 의 새벽 1시는 달력으로 10-02 다").toBe(dawn);
  });

  it("시각 없이 들고 온 4단계 담당자는 버린다", () => {
    expect(read("product=p-staff&d=2026-10-01&r=r1").resourceId, "나중에 고른 시각에 그 사람이 없을 수 있다").toBeNull();
    expect(read(`product=p-staff&d=2026-10-01&t=${encodeURIComponent(T)}&r=r1`).resourceId).toBe("r1");
  });

  it("남의 자원 id 와 상품에 없는 '상관없음' 은 받지 않는다", () => {
    expect(read(`product=p-staff&d=2026-10-01&t=${encodeURIComponent(T)}&r=s1`).resourceId, "다른 상품의 자원").toBeNull();
    expect(read("product=p-space&dur=60&r=any").resourceId, "REQUIRED 에 상관없음은 없다").toBeNull();
    expect(read(`product=p-class&d=2026-10-01&t=${encodeURIComponent(T)}&r=c1`).resourceId, "고르지 않는 상품").toBeNull();
  });
});

describe("selectionQuery — 왕복해도 같은 선택이 나온다", () => {
  it("기본값은 싣지 않는다", () => {
    expect(selectionQuery(sel({ productId: staff.id, durationMin: 60, partySize: 1 }), staff)).toBe("product=p-staff");
  });

  it("읽기 → 쓰기 → 읽기가 같다", () => {
    const q = `product=p-space&dur=120&party=3&r=s1&d=2026-10-01&t=${encodeURIComponent(T)}`;
    const a = readSelection(new URLSearchParams(q), all);
    const b = readSelection(new URLSearchParams(selectionQuery(a, space)), all);
    expect(b).toEqual(a);
  });
});

describe("change — 앞 단계를 바꾸면 뒤 단계는 버린다", () => {
  const full = sel({ productId: staff.id, durationMin: 60, partySize: 1, date: "2026-10-01", startAt: T, resourceId: "r1" });

  it("인원이 바뀌면 그 시각이 아직 가능한지 알 수 없다", () => {
    const next = change({ ...full, partySize: 1 }, { partySize: 2 }, staff);
    expect(next.startAt).toBeNull();
    expect(next.date, "날짜까지 버리면 손님이 달력을 다시 찾아야 한다").toBeNull();
    expect(next.resourceId).toBeNull();
  });

  it("날짜를 바꾸면 시각과 (4단계) 담당자를 버린다", () => {
    const next = change(full, { date: "2026-10-02" }, staff);
    expect(next.startAt).toBeNull();
    expect(next.resourceId).toBeNull();
  });

  it("공간형의 공간은 1단계 선택이라 날짜를 바꿔도 남는다", () => {
    const s = sel({ productId: space.id, durationMin: 60, resourceId: "s1", date: "2026-10-01", startAt: T });
    expect(change(s, { date: "2026-10-02" }, space).resourceId).toBe("s1");
  });

  it("시각만 바꿔도 그 시각의 담당자는 다시 고른다", () => {
    expect(change(full, { startAt: "2026-10-01T11:00:00+09:00" }, staff).resourceId).toBeNull();
  });
});
