import type { WidgetProduct } from "./data";

/**
 * 예약 위젯의 단계 판정과 주소 규칙 (FR-SITE-020). **순수 함수** — DOM 도 fetch 도 모른다.
 *
 * 선택 상태는 전부 **URL 쿼리**에 있다. 컴포넌트 상태로 들고 있으면 뒤로가기가 위젯을 통째로 닫고(#85),
 * 새로고침·앱 이탈에 사라진다. "지금 몇 단계인가" 도 따로 저장하지 않고 **선택에서 유도한다** —
 * 저장하면 "3단계인데 날짜가 없다" 같은 상태가 만들어진다.
 *
 * 단계 순서의 근거는 명세에 있다: 인원·이용 시간은 슬롯 계산의 **입력**이라 먼저 받고,
 * 담당자는 "이 시각 가능한 분" 만 보여 주려고 시간 뒤에 받는다.
 */

/** 자원 미지정과 "상관없음" 은 다르다 — 뒤엣것은 손님이 고른 것이라 다음 단계로 넘어간다 */
export const ANY_RESOURCE = "any";

export type Selection = {
  productId: string | null;
  /** `durationOptions` 가 있는 상품만 의미가 있다. 없으면 상품의 `durationMin` */
  durationMin: number | null;
  partySize: number;
  resourceId: string | typeof ANY_RESOURCE | null;
  /** 영업일 `YYYY-MM-DD` (사업장 로컬) */
  date: string | null;
  /** 슬롯 시작 — 오프셋을 가진 ISO 8601. 슬롯 API 가 준 문자열 그대로 */
  startAt: string | null;
};

export type Step = 1 | 2 | 3 | 4 | 5;

export const EMPTY: Selection = { productId: null, durationMin: null, partySize: 1, resourceId: null, date: null, startAt: null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 슬롯 API 가 돌려주는 모양만 받는다 — 손으로 고친 주소가 그대로 예약 생성까지 흘러가지 않게 */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** 이용 시간을 손님이 고르는 상품인가 (공간형) */
export const needsDuration = (p: WidgetProduct): boolean => (p.durationOptions?.length ?? 0) > 1;
/** 인원을 받는 상품인가. `maxPartySize = 1` 이면 아예 노출하지 않는다 (명세) */
export const needsParty = (p: WidgetProduct): boolean => p.maxPartySize > 1;

/**
 * 담당자를 어디서 고르는가.
 * - `REQUIRED`(공간형): 슬롯 조회에 자원이 **입력**이라 1단계에서 받는다. 안 받으면 API 가 `RESOURCE_REQUIRED` 로 400 이다
 * - `OPTIONAL`(담당자형): 시간 뒤 4단계. "이 시각 가능한 분" 만 보여 준다
 * - `AUTO` · `NONE`: 손님이 고르지 않는다
 */
export function resourcePick(p: WidgetProduct): "step1" | "step4" | "none" {
  if (p.resourceSelectMode === "REQUIRED") return "step1";
  if (p.resourceSelectMode === "OPTIONAL") return "step4";
  return "none";
}

/** 이 상품에서 고를 수 있는 이용 시간 목록 (없으면 `durationMin` 하나) */
export const durationChoices = (p: WidgetProduct): number[] => (p.durationOptions?.length ? [...p.durationOptions].sort((a, b) => a - b) : [p.durationMin]);

/** 슬롯 조회·예약 생성에 실제로 쓸 이용 시간 */
export const effectiveDuration = (p: WidgetProduct, sel: Selection): number => (sel.durationMin !== null && durationChoices(p).includes(sel.durationMin) ? sel.durationMin : p.durationMin);

/**
 * 지금 보여 줄 단계. 앞 단계가 비어 있으면 뒤로 못 간다 — 뒤로가기와 주소 직접 입력이 같은 규칙을 탄다.
 */
export function stepOf(sel: Selection, p: WidgetProduct | null): Step {
  if (!p) return 1;
  if (needsDuration(p) && sel.durationMin === null) return 1;
  if (resourcePick(p) === "step1" && !sel.resourceId) return 1;
  if (!sel.date) return 2;
  if (!sel.startAt) return 3;
  if (resourcePick(p) === "step4" && !sel.resourceId) return 4;
  return 5;
}

/**
 * 주소 → 선택. **모르는 값은 조용히 버린다**(400 을 내지 않는다) — 손님이 링크를 잘라 붙였을 때
 * 오류 화면 대신 그 앞 단계에서 시작하는 편이 낫다. 다만 버릴 때는 **뒤따르는 선택도 같이 버린다**:
 * 상품이 없는데 시각만 남아 있으면 "3단계인데 상품이 없다" 가 된다.
 */
export function readSelection(params: URLSearchParams | Record<string, string | undefined>, products: WidgetProduct[]): Selection {
  const get = (k: string): string | null => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return v == null || v === "" ? null : v;
  };
  const product = products.find((p) => p.id === get("product")) ?? null;
  if (!product) return EMPTY;

  const choices = durationChoices(product);
  const durRaw = Number(get("dur"));
  const durationMin = choices.includes(durRaw) ? durRaw : needsDuration(product) ? null : product.durationMin;

  const partyRaw = Number(get("party"));
  const partySize = Number.isInteger(partyRaw) && partyRaw >= 1 && partyRaw <= product.maxPartySize ? partyRaw : 1;

  const pick = resourcePick(product);
  const rRaw = get("r");
  const resourceId =
    pick === "none" ? null : rRaw === ANY_RESOURCE && pick === "step4" ? ANY_RESOURCE : product.resources.some((x) => x.id === rRaw) ? rRaw : null;

  const dateRaw = get("d");
  // 1단계가 안 끝났으면 날짜도 의미가 없다 — 슬롯이 그 값들로 계산되기 때문이다
  const stepOneDone = durationMin !== null && (pick !== "step1" || resourceId !== null);
  const date = stepOneDone && dateRaw && DATE_RE.test(dateRaw) ? dateRaw : null;

  const tRaw = get("t");
  // 시각은 그날의 것이어야 한다. 영업일이 자정을 넘으면 시각의 달력 날짜는 하루 뒤일 수 있어
  // 문자열 앞 10자만 비교하면 멀쩡한 새벽 슬롯이 버려진다 — 모양만 보고, 실제 유효성은 슬롯 목록이 판정한다
  const startAt = date && tRaw && INSTANT_RE.test(tRaw) ? tRaw : null;

  // 4단계 자원은 **시각이 정해진 뒤**의 선택이다. 시각 없이 `r` 만 들고 오면 버린다 —
  // 안 그러면 나중에 고른 시각에 그 사람이 없어도 확인 화면까지 그대로 실려 간다
  return { productId: product.id, durationMin, partySize, resourceId: pick === "step4" && !startAt ? null : resourceId, date, startAt };
}

/** 선택 → 주소 쿼리. 기본값과 같은 것은 싣지 않는다 (주소가 짧아야 카톡에서 잘리지 않는다) */
export function selectionQuery(sel: Selection, p: WidgetProduct | null): string {
  const q = new URLSearchParams();
  if (sel.productId) q.set("product", sel.productId);
  if (p && needsDuration(p) && sel.durationMin !== null) q.set("dur", String(sel.durationMin));
  if (sel.partySize > 1) q.set("party", String(sel.partySize));
  if (sel.resourceId) q.set("r", sel.resourceId);
  if (sel.date) q.set("d", sel.date);
  if (sel.startAt) q.set("t", sel.startAt);
  return q.toString();
}

/**
 * 앞 단계를 바꾸면 **뒤 단계는 버린다.** 인원이나 이용 시간이 바뀌면 그 시각이 아직 가능한지 알 수 없고,
 * 남겨 두면 손님은 고른 적 없는 시각으로 확인 화면에 도착한다.
 */
export function change(sel: Selection, patch: Partial<Selection>, p: WidgetProduct | null): Selection {
  const next = { ...sel, ...patch };
  const invalidates = (["productId", "durationMin", "partySize"] as const).some((k) => k in patch && patch[k] !== sel[k]);
  if (invalidates) return { ...next, date: "date" in patch ? next.date : null, startAt: null, resourceId: p && resourcePick(p) === "step1" ? next.resourceId : null };
  if ("date" in patch && patch.date !== sel.date) return { ...next, startAt: null, resourceId: p && resourcePick(p) === "step4" ? null : next.resourceId };
  if ("startAt" in patch && patch.startAt !== sel.startAt) return { ...next, resourceId: p && resourcePick(p) === "step4" ? null : next.resourceId };
  return next;
}
