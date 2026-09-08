/**
 * 프리셋 3종 (FR-PRD-010 "프리셋 → 필드 매핑", 기획서 4.1). 초기값일 뿐 잠금이 아니다 — 고급 설정에서 어떤 조합이든 만들 수 있다.
 * 수업형의 정원은 "자원 정원" 이라 여기서는 채우지 않고, 폼이 고른 자원의 정원 최솟값으로 채운다.
 * 공간형의 "정원 1 · 최대 4명" 은 모순이 아니다 — 정원 1 은 한 팀이 방을 통째로 쓴다는 뜻(팀 단위)이고 4명은 그 팀의 인원 상한이다.
 */
export type PresetKey = "staff" | "space" | "class";

export type Preset = {
  key: PresetKey;
  title: string;
  examples: string;
  bullets: [string, string, string];
  /** 권장 자원 타입 — 폼이 자원 목록을 이 타입 우선으로 정렬·선택한다 */
  recommendedResource: "STAFF" | "SPACE" | "SHARED";
  values: {
    startMode: "FREE" | "FIXED";
    slotIntervalMin: 10 | 15 | 20 | 30 | 60 | null;
    durationMin: number;
    durationOptions: number[] | null;
    capacityPerSlot: number | null;
    maxPartySize: number;
    resourceSelectMode: "REQUIRED" | "OPTIONAL" | "AUTO" | "NONE";
    bufferBeforeMin: number;
    bufferAfterMin: number;
  };
};

export const PRESETS: Preset[] = [
  {
    key: "staff",
    title: "담당자를 지정해서",
    examples: "네일 · 헤어 · PT · 상담",
    bullets: ["30분 간격으로 열림", "한 타임에 한 분", "담당자 근무표에 맞춰 자동"],
    recommendedResource: "STAFF",
    values: { startMode: "FREE", slotIntervalMin: 30, durationMin: 60, durationOptions: null, capacityPerSlot: 1, maxPartySize: 1, resourceSelectMode: "OPTIONAL", bufferBeforeMin: 0, bufferAfterMin: 0 },
  },
  {
    key: "space",
    title: "공간을 시간 단위로",
    examples: "스터디룸 · 스튜디오 · 회의실",
    bullets: ["이용 시간을 고객이 선택", "1 · 2 · 4시간", "예약 사이 정리 시간 확보"],
    recommendedResource: "SPACE",
    values: { startMode: "FREE", slotIntervalMin: 30, durationMin: 60, durationOptions: [60, 120, 240], capacityPerSlot: 1, maxPartySize: 4, resourceSelectMode: "REQUIRED", bufferBeforeMin: 0, bufferAfterMin: 15 },
  },
  {
    key: "class",
    title: "정해진 시간에 여러 명",
    examples: "요가 · 원데이클래스 · 체험",
    bullets: ["회차 시간표를 직접 등록", "회차마다 정원", "남은 자리 실시간 표시"],
    recommendedResource: "SHARED",
    values: { startMode: "FIXED", slotIntervalMin: null, durationMin: 60, durationOptions: null, capacityPerSlot: null, maxPartySize: 2, resourceSelectMode: "NONE", bufferBeforeMin: 0, bufferAfterMin: 0 },
  },
];

/** 저장된 상품이 어느 프리셋에 가장 가까운지 — 수정 화면의 카드 선택 표시용 (판정일 뿐 저장하지 않는다) */
export function guessPreset(p: { startMode: "FREE" | "FIXED"; durationOptions: number[] | null; capacityPerSlot: number }): PresetKey {
  if (p.startMode === "FIXED") return "class";
  if (p.durationOptions && p.durationOptions.length > 0) return "space";
  return "staff";
}
