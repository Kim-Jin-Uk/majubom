"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { ResourceItem } from "@/features/business/resources";
import { guessPreset, PRESETS, type PresetKey } from "@/features/product/presets";
import type { ProductDetail, ProductWarning } from "@/features/product/products";
import { MAX_FIXED_TIMES_PER_DAY, MAX_IMAGES, SLOT_INTERVALS } from "@/features/product/schema";
import { apiPost, apiPut, describeError, fieldErrors } from "@/lib/client-api";
import { uploadImage } from "@/lib/upload-client";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const TYPE_TEXT = { STAFF: "담당자", SPACE: "공간", SHARED: "공용" } as const;

const SELECT_MODES: Array<[ProductDetail["resourceSelectMode"], string, string]> = [
  ["OPTIONAL", "고객이 고를 수 있어요 (선택)", "고르지 않으면 비어 있는 담당자에게 자동 배정 — 헤어·네일에 흔한 방식"],
  ["REQUIRED", "고객이 꼭 골라야 해요", "방·좌석처럼 어디를 쓰는지가 예약의 핵심일 때"],
  ["AUTO", "항상 자동 배정", "고객은 시간만 고르고 담당자·공간은 매장이 정해요"],
  ["NONE", "자원 선택 없음", "수업처럼 정원만 있고 누가 맡는지는 고객이 몰라도 될 때"],
];

const STATUS_TEXT = { DRAFT: "초안 — 예약 페이지에 안 보임", ACTIVE: "공개 — 예약 받는 중", HIDDEN: "숨김 — 잠시 내려둠" } as const;

type Draft = {
  name: string;
  description: string;
  images: string[];
  startMode: "FREE" | "FIXED";
  slotIntervalMin: number;
  fixed: Record<number, string[]>;
  durationMin: string;
  durationOptions: number[];
  bufferBeforeMin: string;
  bufferAfterMin: string;
  capacityPerSlot: string;
  maxPartySize: string;
  priceDisplay: string;
  resourceIds: string[];
  resourceSelectMode: ProductDetail["resourceSelectMode"];
  status: "DRAFT" | "ACTIVE" | "HIDDEN";
};

function fromDetail(p: ProductDetail): Draft {
  return {
    name: p.name,
    description: p.description ?? "",
    images: p.images,
    startMode: p.startMode,
    slotIntervalMin: p.slotIntervalMin ?? 30,
    fixed: Object.fromEntries((p.fixedStartTimes ?? []).map((d) => [d.dow, d.times])),
    durationMin: String(p.durationMin),
    durationOptions: p.durationOptions ?? [],
    bufferBeforeMin: String(p.bufferBeforeMin),
    bufferAfterMin: String(p.bufferAfterMin),
    capacityPerSlot: String(p.capacityPerSlot),
    maxPartySize: String(p.maxPartySize),
    priceDisplay: p.priceDisplay ?? "",
    resourceIds: p.resourceIds,
    resourceSelectMode: p.resourceSelectMode,
    status: p.status === "ARCHIVED" ? "HIDDEN" : p.status,
  };
}

function applyPreset(key: PresetKey, resources: ResourceItem[], base: Draft): Draft {
  const pr = PRESETS.find((x) => x.key === key)!;
  const v = pr.values;
  const preferred = resources.filter((r) => r.isActive && r.type === pr.recommendedResource);
  const pick = (preferred.length ? preferred : resources.filter((r) => r.isActive)).slice(0, key === "class" ? 1 : 50);
  const minCap = pick.length ? Math.min(...pick.map((r) => r.capacity)) : 1;
  return {
    ...base,
    startMode: v.startMode,
    slotIntervalMin: v.slotIntervalMin ?? 30,
    durationMin: String(v.durationMin),
    durationOptions: v.durationOptions ?? [],
    capacityPerSlot: String(v.capacityPerSlot ?? minCap),
    maxPartySize: String(Math.min(v.maxPartySize, v.capacityPerSlot ?? minCap)),
    resourceSelectMode: v.resourceSelectMode,
    bufferBeforeMin: String(v.bufferBeforeMin),
    bufferAfterMin: String(v.bufferAfterMin),
    resourceIds: pick.map((r) => r.id),
    fixed: v.startMode === "FIXED" && Object.keys(base.fixed).length === 0 ? { 1: ["10:00", "19:00"], 3: ["10:00", "19:00"], 5: ["10:00", "19:00"] } : base.fixed,
  };
}

const EMPTY: Draft = { name: "", description: "", images: [], startMode: "FREE", slotIntervalMin: 30, fixed: {}, durationMin: "60", durationOptions: [], bufferBeforeMin: "0", bufferAfterMin: "0", capacityPerSlot: "1", maxPartySize: "1", priceDisplay: "", resourceIds: [], resourceSelectMode: "OPTIONAL", status: "DRAFT" };

const ERR_TEXT: Record<string, string> = {
  ARCHIVED: "보관된 상품은 수정할 수 없어요",
  NOT_ASSIGNED: "본인이 담당하는 상품만 수정할 수 있어요",
  STATUS_NOT_TOGGLEABLE: "초안 상품의 공개는 사업자만 할 수 있어요",
};

/**
 * 상품 등록·수정 (FR-PRD-010 · 020, #32 #34 #35). 프리셋 카드 → 3스위치 값 자동 채움 → 고급 설정에서 조정.
 * limited: 매니저(editProduct) — 설명·사진·상태만 편집 가능, 나머지는 읽기 전용으로 보인다.
 */
export function ProductForm({ businessId, resources, initial, mode, limited, readOnly }: { businessId: string; resources: ResourceItem[]; initial: ProductDetail | null; mode: "wizard" | "page"; limited: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetKey | null>(initial ? guessPreset(initial) : null);
  // 위저드의 첫 상품은 공개 상태로 시작한다 — 공개 조건(활성 상품 ≥ 1)을 채우는 게 이 단계의 목적. 홈페이지 자체는 승인 전엔 열리지 않는다
  const [d, setD] = useState<Draft>(() => (initial ? fromDetail(initial) : mode === "wizard" ? { ...EMPTY, status: "ACTIVE" } : EMPTY));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [warnings, setWarnings] = useState<ProductWarning[]>(initial?.warnings ?? []);
  const [busy, setBusy] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [newTime, setNewTime] = useState<Record<number, string>>({});
  const [newOption, setNewOption] = useState("");

  const lockShape = readOnly || limited;
  const active = resources.filter((r) => r.isActive || d.resourceIds.includes(r.id));
  const chosen = resources.filter((r) => d.resourceIds.includes(r.id));
  const minCap = chosen.length ? Math.min(...chosen.map((r) => r.capacity)) : null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => (e[k as string] ? { ...e, [k as string]: "" } : e));
  };

  function choosePreset(key: PresetKey) {
    setPreset(key);
    setD((x) => applyPreset(key, resources, x));
    setErrors({});
  }

  function toggleResource(id: string) {
    const r = resources.find((x) => x.id === id)!;
    set(
      "resourceIds",
      d.resourceIds.includes(id) ? d.resourceIds.filter((x) => x !== id) : [...d.resourceIds, id],
    );
    // 수업형(정원 N) 에서 자원을 처음 고르면 정원을 그 자원 정원으로
    if (!d.resourceIds.includes(id) && d.startMode === "FIXED" && d.resourceIds.length === 0) set("capacityPerSlot", String(r.capacity));
  }

  function body(confirmAffected = false) {
    if (limited) return { description: d.description || null, images: d.images, status: d.status === "DRAFT" ? undefined : d.status };
    return {
      name: d.name,
      description: d.description || null,
      images: d.images,
      startMode: d.startMode,
      slotIntervalMin: d.startMode === "FREE" ? d.slotIntervalMin : null,
      fixedStartTimes: d.startMode === "FIXED" ? Object.entries(d.fixed).filter(([, t]) => t.length).map(([dow, times]) => ({ dow: Number(dow), times })) : null,
      durationMin: Number(d.durationMin),
      durationOptions: d.startMode === "FREE" && d.durationOptions.length ? d.durationOptions : null,
      bufferBeforeMin: Number(d.bufferBeforeMin || 0),
      bufferAfterMin: Number(d.bufferAfterMin || 0),
      capacityPerSlot: Number(d.capacityPerSlot),
      maxPartySize: Number(d.maxPartySize),
      priceDisplay: d.priceDisplay || null,
      resourceIds: d.resourceIds,
      resourceSelectMode: d.resourceSelectMode,
      status: d.status,
      confirmAffected,
    };
  }

  async function submit(e: FormEvent, confirmAffected = false) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    setWarnings([]);
    const r = initial ? await apiPut<{ warnings: ProductWarning[]; affected: number }>(`/api/console/products/${initial.id}`, body(confirmAffected)) : await apiPost<{ id: string; warnings: ProductWarning[] }>("/api/console/products", body());
    setBusy(false);
    if (!r.ok) {
      if (r.error === "AFFECTS_RESERVATIONS") {
        const n = Number(r.data?.count ?? 0);
        if (confirm(`앞으로의 예약 ${n}건이 있어요. 기존 예약 ${n}건은 예약 당시 설정을 그대로 유지하고, 새 예약부터 바뀐 설정이 적용됩니다. 계속할까요?`)) return submit(e, true);
        return;
      }
      if (r.issues) {
        const fe = fieldErrors(r.issues);
        setErrors(fe);
        const first = r.issues[0];
        setMsg({ kind: "error", text: first ? `${first.message}` : "입력 내용을 확인해 주세요" });
      } else setMsg({ kind: "error", text: ERR_TEXT[r.error] ?? describeError(r) });
      return;
    }
    const w = r.data.warnings ?? [];
    if (initial) {
      setWarnings(w);
      setMsg({ kind: "ok", text: `저장했어요${"affected" in r.data && r.data.affected ? ` — 기존 예약 ${r.data.affected}건은 이전 설정을 유지합니다` : ""}` });
      router.refresh();
      return;
    }
    const id = (r.data as { id: string }).id;
    if (w.length) {
      // 경고를 보여줘야 하니 수정 화면으로 — 거기서 회차를 고칠 수 있다
      router.push(`/console/products/${id}?saved=1&warn=${w.length}`);
      return;
    }
    router.push(mode === "wizard" ? "/console/onboarding/4" : "/console/products");
    router.refresh();
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadNote(null);
    const room = MAX_IMAGES - d.images.length;
    for (const f of Array.from(files).slice(0, room)) {
      const r = await uploadImage(f, "product", businessId);
      if (!r.ok) {
        setUploadNote(r.message ?? "업로드하지 못했어요");
        if (r.error === "STORAGE_NOT_CONFIGURED") break;
        continue;
      }
      setD((x) => ({ ...x, images: [...x.images, r.url].slice(0, MAX_IMAGES) }));
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function addUrl() {
    const u = urlInput.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) return setUploadNote("http(s) 로 시작하는 주소만 넣을 수 있어요");
    setD((x) => ({ ...x, images: [...x.images, u].slice(0, MAX_IMAGES) }));
    setUrlInput("");
    setUploadNote(null);
  }

  function moveImage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= d.images.length) return;
    const arr = d.images.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("images", arr);
  }

  function addTime(dow: number) {
    const t = newTime[dow];
    if (!t) return;
    const cur = d.fixed[dow] ?? [];
    if (cur.includes(t) || cur.length >= MAX_FIXED_TIMES_PER_DAY) return;
    set("fixed", { ...d.fixed, [dow]: [...cur, t].sort() });
    setNewTime((x) => ({ ...x, [dow]: "" }));
  }

  function addOption() {
    const n = Number(newOption);
    if (!n || n % 5 !== 0 || n < 5 || n > 480 || d.durationOptions.includes(n) || d.durationOptions.length >= 6) return;
    const opts = [...d.durationOptions, n].sort((a, b) => a - b);
    set("durationOptions", opts);
    if (!opts.includes(Number(d.durationMin))) set("durationMin", String(opts[0]));
    setNewOption("");
  }

  const need = Number(d.durationMin || 0) + Number(d.bufferBeforeMin || 0) + Number(d.bufferAfterMin || 0);

  return (
    <form className="panel" onSubmit={(e) => submit(e)} style={{ gap: 22 }}>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {warnings.length > 0 && (
        <Alert kind="warn">
          영업시간 밖이라 예약 페이지에 표시되지 않는 회차가 있어요: {warnings.map((w) => `${DOW[w.dow]} ${w.time}${w.reason === "CLOSED_DAY" ? "(휴무일)" : ""}`).join(", ")}. 회차를 고치거나 설정에서 영업시간을 늘려 주세요.
        </Alert>
      )}

      {!limited && !initial && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <h2>어떤 방식으로 예약을 받으시나요?</h2>
            <p className="sub" style={{ marginTop: 4 }}>고르시면 소요 시간·정원 같은 값이 알맞게 채워져요. 아래 고급 설정에서 다 바꿀 수 있어요.</p>
          </div>
          <div className="preset-grid" role="radiogroup" aria-label="예약 방식 프리셋">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} className={preset === p.key ? "pre sel" : "pre"} onClick={() => choosePreset(p.key)} disabled={readOnly}>
                <div className="ic" aria-hidden="true">
                  {p.key === "staff" ? "👤" : p.key === "space" ? "🏠" : "👥"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <b>{p.title}</b>
                  <span className="faint">{p.examples}</span>
                </div>
                <ul>
                  {p.bullets.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>기본 정보</h2>
        <div className="grid-2">
          <Field label="상품 이름" htmlFor="p-name" error={errors.name} hint="40자 이내. 예: 젤네일 기본, A룸 · 화이트 호리존, 하타 요가">
            <Input id="p-name" required maxLength={40} value={d.name} onChange={(e) => set("name", e.target.value)} disabled={lockShape} aria-invalid={!!errors.name} />
          </Field>
          <Field label="가격 표기 (선택)" htmlFor="p-price" error={errors.priceDisplay} hint="자유롭게 — 결제는 연동하지 않아요">
            <Input id="p-price" maxLength={50} value={d.priceDisplay} onChange={(e) => set("priceDisplay", e.target.value)} disabled={lockShape} placeholder="시간당 40,000원 · 상담 후 결정" />
          </Field>
        </div>
        <Field label="설명 (선택)" htmlFor="p-desc" error={errors.description} hint="줄바꿈만 됩니다 (1000자)">
          <textarea id="p-desc" className="textarea" maxLength={1000} value={d.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} />
        </Field>
        <div className="field">
          <span className="field-label">사진 (최대 {MAX_IMAGES}장 · 장당 5MB · 첫 장이 대표)</span>
          <div className="img-grid">
            {d.images.map((u, i) => (
              <div key={u + i} className="img">
                {/* eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL, 크기 미지 */}
                <img src={u} alt={`상품 사진 ${i + 1}`} />
                {i === 0 && <span className="badge">대표</span>}
                {!readOnly && (
                  <button type="button" className="rm" aria-label={`사진 ${i + 1} 삭제`} onClick={() => set("images", d.images.filter((_, k) => k !== i))}>
                    ✕
                  </button>
                )}
                {!readOnly && i > 0 && (
                  <button type="button" className="rm" style={{ right: 30 }} aria-label={`사진 ${i + 1} 앞으로`} onClick={() => moveImage(i, -1)}>
                    ←
                  </button>
                )}
              </div>
            ))}
            {!readOnly && d.images.length < MAX_IMAGES && (
              <button type="button" className="add" onClick={() => fileRef.current?.click()}>
                + 사진 추가
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          {uploadNote && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="hint" style={{ color: "var(--warn)" }}>
                {uploadNote}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://… 이미지 주소를 직접 넣을 수도 있어요" aria-label="이미지 URL" />
                <Button type="button" size="sm" onClick={addUrl}>
                  추가
                </Button>
              </div>
            </div>
          )}
          {errors.images && <span className="err">{errors.images}</span>}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>예약 방식{limited && <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>사업자만 바꿀 수 있어요</span>}</h2>
        <div className="radio-cards">
          <label className={d.startMode === "FREE" ? "radio-card on" : "radio-card"}>
            <input type="radio" name="startMode" checked={d.startMode === "FREE"} onChange={() => set("startMode", "FREE")} disabled={lockShape} />
            <span>
              <b>자유 시작</b>
              <span className="hint">영업시간을 간격으로 잘라 어디서든 시작 (10:00, 10:30 …). 담당자형·공간형</span>
            </span>
          </label>
          <label className={d.startMode === "FIXED" ? "radio-card on" : "radio-card"}>
            <input type="radio" name="startMode" checked={d.startMode === "FIXED"} onChange={() => set("startMode", "FIXED")} disabled={lockShape} />
            <span>
              <b>고정 회차</b>
              <span className="hint">정해 둔 시각에만 (10:00, 13:00, 16:00). 수업·체험</span>
            </span>
          </label>
        </div>

        {d.startMode === "FREE" ? (
          <div className="grid-2">
            <Field label="슬롯 간격" htmlFor="p-interval" error={errors.slotIntervalMin} hint="예약 시작 시각이 열리는 간격">
              <select id="p-interval" className="select" value={d.slotIntervalMin} onChange={(e) => set("slotIntervalMin", Number(e.target.value))} disabled={lockShape}>
                {SLOT_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {n}분
                  </option>
                ))}
              </select>
            </Field>
            <Field label={d.durationOptions.length ? "기본 소요 시간" : "소요 시간"} htmlFor="p-dur" error={errors.durationMin} hint="5분 단위, 5~480분">
              {d.durationOptions.length ? (
                <select id="p-dur" className="select" value={d.durationMin} onChange={(e) => set("durationMin", e.target.value)} disabled={lockShape}>
                  {d.durationOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}분
                    </option>
                  ))}
                </select>
              ) : (
                <Input id="p-dur" type="number" min={5} max={480} step={5} required value={d.durationMin} onChange={(e) => set("durationMin", e.target.value)} disabled={lockShape} aria-invalid={!!errors.durationMin} />
              )}
            </Field>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="field-label" id="lbl-options">이용 시간 선택지 (선택) — 고객이 고릅니다</span>
              <div className="chips" role="group" aria-labelledby="lbl-options">
                {d.durationOptions.map((n) => (
                  <span key={n} className={Number(d.durationMin) === n ? "chip on default" : "chip on"} style={{ paddingRight: lockShape ? undefined : 6 }}>
                    <button type="button" className="chip-btn" onClick={() => set("durationMin", String(n))} disabled={lockShape} aria-pressed={Number(d.durationMin) === n} title="기본값으로">
                      {n >= 60 && n % 60 === 0 ? `${n / 60}시간` : `${n}분`}
                    </button>
                    {!lockShape && (
                      <button
                        type="button"
                        className="chip-btn x"
                        aria-label={`${n}분 옵션 삭제`}
                        onClick={() => {
                          const opts = d.durationOptions.filter((x) => x !== n);
                          set("durationOptions", opts);
                          if (opts.length && !opts.includes(Number(d.durationMin))) set("durationMin", String(opts[0]));
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {!lockShape && d.durationOptions.length < 6 && (
                  <>
                    <Input type="number" min={5} max={480} step={5} value={newOption} onChange={(e) => setNewOption(e.target.value)} placeholder="분" aria-label="추가할 이용 시간(분)" style={{ width: 90, height: 34 }} />
                    <button type="button" className="chip" onClick={addOption}>
                      + 추가
                    </button>
                  </>
                )}
              </div>
              {errors.durationOptions && <span className="err">{errors.durationOptions}</span>}
              {!errors.durationOptions && <span className="hint">비워 두면 소요 시간이 고정됩니다. 진하게 표시된 것이 기본값</span>}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="grid-2">
              <Field label="회차 길이 (소요 시간)" htmlFor="p-dur" error={errors.durationMin} hint="5분 단위. 회차 간격은 이 시간 + 버퍼보다 길어야 해요">
                <Input id="p-dur" type="number" min={5} max={480} step={5} required value={d.durationMin} onChange={(e) => set("durationMin", e.target.value)} disabled={lockShape} aria-invalid={!!errors.durationMin} />
              </Field>
            </div>
            <div className="field">
              <span className="field-label" id="lbl-fixed">회차 시간표 — 요일별 시작 시각 (요일당 최대 {MAX_FIXED_TIMES_PER_DAY}개)</span>
              <div className="hours">
                {DOW.map((name, dow) => (
                  <div key={dow} className="hours-row">
                    <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: "34px" }}>{name}요일</span>
                    <div className="chips">
                      {(d.fixed[dow] ?? []).map((t) => (
                        <span key={t} className="chip on">
                          {t}
                          {!lockShape && (
                            <button type="button" className="chip-btn x" aria-label={`${name}요일 ${t} 회차 삭제`} onClick={() => set("fixed", { ...d.fixed, [dow]: (d.fixed[dow] ?? []).filter((x) => x !== t) })}>
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {!lockShape && (d.fixed[dow]?.length ?? 0) < MAX_FIXED_TIMES_PER_DAY && (
                        <>
                          <Input type="time" value={newTime[dow] ?? ""} onChange={(e) => setNewTime((x) => ({ ...x, [dow]: e.target.value }))} aria-label={`${name}요일 회차 시작 시각`} style={{ width: 120, height: 34 }} />
                          <button type="button" className="chip" onClick={() => addTime(dow)}>
                            + 회차
                          </button>
                        </>
                      )}
                      {(d.fixed[dow] ?? []).length === 0 && lockShape && <span className="muted" style={{ fontSize: 13, lineHeight: "34px" }}>없음</span>}
                    </div>
                  </div>
                ))}
              </div>
              {errors.fixedStartTimes && <span className="err">{errors.fixedStartTimes}</span>}
              {!errors.fixedStartTimes && <span className="hint">회차 간격이 {need}분(소요 시간 + 버퍼)보다 짧으면 저장되지 않아요. 영업시간 밖 회차는 저장되지만 예약 페이지에 보이지 않습니다</span>}
            </div>
          </div>
        )}

        <div className="grid-2">
          <Field label="준비 버퍼 (앞)" htmlFor="p-bb" error={errors.bufferBeforeMin} hint="0~60분. 슬롯을 점유하지만 고객에게는 보이지 않아요">
            <Input id="p-bb" type="number" min={0} max={60} step={5} value={d.bufferBeforeMin} onChange={(e) => set("bufferBeforeMin", e.target.value)} disabled={lockShape} />
          </Field>
          <Field label="정리 버퍼 (뒤)" htmlFor="p-ba" error={errors.bufferAfterMin}>
            <Input id="p-ba" type="number" min={0} max={60} step={5} value={d.bufferAfterMin} onChange={(e) => set("bufferAfterMin", e.target.value)} disabled={lockShape} />
          </Field>
        </div>
        {Number(d.bufferAfterMin) > 0 && (
          <div className="info-box">정리 시간은 예약 시간에서 빼지 않아요. 고객은 14:00~16:00을 그대로 쓰고, 다음 예약은 16:{String(Number(d.bufferAfterMin)).padStart(2, "0")}부터 열려요.</div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>정원</h2>
        <div className="grid-2">
          <Field label="슬롯당 정원" htmlFor="p-cap" error={errors.capacityPerSlot} hint={minCap !== null ? `연결한 자원의 정원(${minCap}명) 이하` : "한 회차(슬롯)에 받을 수 있는 총 인원"}>
            <Input id="p-cap" type="number" min={1} max={500} required value={d.capacityPerSlot} onChange={(e) => set("capacityPerSlot", e.target.value)} disabled={lockShape} aria-invalid={!!errors.capacityPerSlot} />
          </Field>
          <Field label="1건 최대 인원" htmlFor="p-party" error={errors.maxPartySize} hint="고객 한 명이 한 번에 예약할 수 있는 인원">
            <Input id="p-party" type="number" min={1} max={500} required value={d.maxPartySize} onChange={(e) => set("maxPartySize", e.target.value)} disabled={lockShape} aria-invalid={!!errors.maxPartySize} />
          </Field>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>담당 자원</h2>
        {active.length === 0 ? (
          <Alert kind="warn">
            등록된 담당자·공간이 없어요. <Link href="/console/resources">담당자 · 공간</Link>에서 먼저 하나 이상 등록해 주세요.
          </Alert>
        ) : (
          <div className="chips" role="group" aria-label="담당 자원">
            {active.map((r) => (
              <label key={r.id} className={d.resourceIds.includes(r.id) ? "chip on" : "chip"} style={{ cursor: lockShape ? "default" : "pointer", opacity: r.isActive ? 1 : 0.6 }}>
                <input type="checkbox" className="sr-only" checked={d.resourceIds.includes(r.id)} onChange={() => toggleResource(r.id)} disabled={lockShape} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {TYPE_TEXT[r.type]}
                </span>
                {r.name}
                <span className="muted" style={{ fontSize: 11 }}>
                  {r.capacity}명{r.isActive ? "" : " · 비활성"}
                </span>
              </label>
            ))}
          </div>
        )}
        {errors.resourceIds && <span className="err">{errors.resourceIds}</span>}
        <div className="field">
          <span className="field-label" id="lbl-rsm">고객이 자원을 고르는 방식</span>
          <div className="radio-cards" role="radiogroup" aria-labelledby="lbl-rsm">
            {SELECT_MODES.map(([k, label, hint]) => (
              <label key={k} className={d.resourceSelectMode === k ? "radio-card on" : "radio-card"}>
                <input type="radio" name="rsm" checked={d.resourceSelectMode === k} onChange={() => set("resourceSelectMode", k)} disabled={lockShape} />
                <span>
                  <b>{label}</b>
                  <span className="hint">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2>노출</h2>
        <div className="radio-cards" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {(["DRAFT", "ACTIVE", "HIDDEN"] as const).map((s) => (
            <label key={s} className={d.status === s ? "radio-card on" : "radio-card"}>
              <input type="radio" name="status" checked={d.status === s} onChange={() => set("status", s)} disabled={readOnly || (limited && (s === "DRAFT" || initial?.status === "DRAFT"))} />
              <span>{STATUS_TEXT[s]}</span>
            </label>
          ))}
        </div>
        {initial && initial.futureReservations > 0 && !limited && (
          <div className="info-box">앞으로의 예약 {initial.futureReservations}건이 있어요. 예약 방식·정원·자원을 바꾸면 확인을 한 번 더 받고, 기존 예약은 예약 당시 설정을 유지합니다.</div>
        )}
      </section>

      <div className="actions">
        {!readOnly && (
          <Button type="submit" variant="primary" loading={busy}>
            {initial ? "저장" : mode === "wizard" ? "저장하고 다음" : "상품 등록"}
          </Button>
        )}
        <Link href={mode === "wizard" ? "/console/onboarding/4" : "/console/products"} className="btn">
          {mode === "wizard" ? (readOnly ? "다음 단계" : "건너뛰기") : "목록으로"}
        </Link>
      </div>
    </form>
  );
}
