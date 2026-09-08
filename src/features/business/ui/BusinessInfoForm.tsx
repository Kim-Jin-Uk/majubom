"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { OpeningHour } from "@/db/schema";
import { BUSINESS_CATEGORIES } from "@/features/business/policy-defaults";
import type { BusinessSettings } from "@/features/business/settings";
import { apiPatch, describeError, fieldErrors } from "@/lib/client-api";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
/** 편집용 행 — 휴무는 enabled=false. breaks 는 빈 문자열 허용(저장 시 걸러낸다) */
type HourRow = { enabled: boolean; open: string; close: string; breaks: Array<{ start: string; end: string }> };

function toRows(hours: OpeningHour[]): HourRow[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const h = hours.find((x) => x.dow === dow);
    return h ? { enabled: true, open: h.open, close: h.close, breaks: h.breaks ?? [] } : { enabled: false, open: "10:00", close: "20:00", breaks: [] };
  });
}

function fromRows(rows: HourRow[]): OpeningHour[] {
  return rows.flatMap((r, dow) => (r.enabled ? [{ dow, open: r.open, close: r.close, ...(r.breaks.length ? { breaks: r.breaks } : {}) }] : []));
}

const SLUG_ERR: Record<string, string> = {
  SLUG_TAKEN: "다른 사업장이 쓰고 있거나 썼던 주소입니다",
  SLUG_RESERVED: "사용할 수 없는 주소입니다",
  SLUG_SAME: "지금 주소와 같습니다",
};

/**
 * 위저드 1단계 · 설정 화면 공용: 매장 정보 + 영업시간 + 공개 주소(slug).
 * slug 는 별도 저장 — 바꾸면 옛 주소가 영구 예약되는 되돌리기 어려운 변경이라 한 폼에 섞지 않는다.
 */
export function BusinessInfoForm({ initial, mode, readOnly, publicBase }: { initial: BusinessSettings; mode: "wizard" | "settings"; readOnly: boolean; publicBase: string }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: initial.name,
    category: initial.category,
    phone: initial.phone ?? "",
    address: initial.address ?? "",
    addressDetail: initial.addressDetail ?? "",
    description: initial.description ?? "",
  });
  const [rows, setRows] = useState<HourRow[]>(() => toRows(initial.openingHours));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState(initial.slug.startsWith("b-") ? "" : initial.slug);
  const [savedSlug, setSavedSlug] = useState(initial.slug);
  const [slugMsg, setSlugMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [slugBusy, setSlugBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));
  };
  const setRow = (i: number, patch: Partial<HourRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const r = await apiPatch("/api/console/business", {
      ...f,
      phone: f.phone || null,
      address: f.address || null,
      addressDetail: f.addressDetail || null,
      description: f.description || null,
      timezone: initial.timezone,
      openingHours: fromRows(rows.map((x) => ({ ...x, breaks: x.breaks.filter((b) => b.start && b.end) }))),
    });
    setBusy(false);
    if (!r.ok) {
      if (r.issues) {
        setErrors(fieldErrors(r.issues));
        const hour = r.issues.find((i) => i.path[0] === "openingHours");
        setMsg({ kind: "error", text: hour ? `영업시간: ${hour.message}` : "입력 내용을 확인해 주세요" });
      } else setMsg({ kind: "error", text: describeError(r) });
      return;
    }
    if (mode === "wizard") {
      router.push("/console/onboarding/2");
      router.refresh();
      return;
    }
    setMsg({ kind: "ok", text: "저장했습니다" });
    router.refresh();
  }

  async function saveSlug() {
    setSlugBusy(true);
    setSlugMsg(null);
    const r = await apiPatch<{ slug: string }>("/api/console/business/slug", { slug });
    setSlugBusy(false);
    if (!r.ok) {
      setSlugMsg({ kind: "error", text: r.issues ? fieldErrors(r.issues).slug ?? "주소 형식을 확인해 주세요" : SLUG_ERR[r.error] ?? describeError(r) });
      return;
    }
    setSavedSlug(r.data.slug);
    setSlugMsg({ kind: "ok", text: `공개 주소가 ${publicBase}/@${r.data.slug} 로 정해졌습니다` });
    router.refresh();
  }

  const dis = readOnly || busy;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <form className="panel" onSubmit={save}>
        <h2>기본 정보</h2>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="grid-2">
          <Field label="상호" htmlFor="b-name" error={errors.name}>
            <Input id="b-name" required maxLength={100} value={f.name} onChange={set("name")} disabled={dis} aria-invalid={!!errors.name} />
          </Field>
          <Field label="업종" htmlFor="b-cat" error={errors.category}>
            <select id="b-cat" className="select" value={f.category} onChange={set("category")} disabled={dis}>
              {BUSINESS_CATEGORIES.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="매장 전화" htmlFor="b-phone" error={errors.phone} hint="예약 페이지와 고객 알림에 표시됩니다">
            <Input id="b-phone" type="tel" value={f.phone} onChange={set("phone")} disabled={dis} aria-invalid={!!errors.phone} placeholder="02-000-0000" />
          </Field>
          <Field label="사업자등록번호" htmlFor="b-reg" hint="가입 시 등록한 번호는 여기서 바꿀 수 없어요">
            <Input id="b-reg" value={initial.bizRegNo} disabled readOnly />
          </Field>
          <Field label="주소" htmlFor="b-addr" error={errors.address}>
            <Input id="b-addr" value={f.address} onChange={set("address")} disabled={dis} aria-invalid={!!errors.address} placeholder="도로명 주소" />
          </Field>
          <Field label="상세 주소 (선택)" htmlFor="b-addr2" error={errors.addressDetail}>
            <Input id="b-addr2" value={f.addressDetail} onChange={set("addressDetail")} disabled={dis} placeholder="층·호수" />
          </Field>
        </div>
        <Field label="소개 (선택)" htmlFor="b-desc" error={errors.description} hint="예약 페이지 상단에 보이는 한두 문장">
          <textarea id="b-desc" className="textarea" maxLength={2000} value={f.description} onChange={set("description")} disabled={dis} />
        </Field>

        <h2 style={{ marginTop: 6 }}>영업시간</h2>
        <p className="sub">요일을 켜고 시간을 정하세요. 마감이 시작보다 빠르면 다음 날 마감(심야 영업)으로 봅니다. 휴게시간은 하루 최대 2구간.</p>
        <div className="hours">
          {rows.map((r, i) => (
            <div key={i} className="hours-row">
              <label className="check" style={{ height: 38 }}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(i, { enabled: e.target.checked })} disabled={dis} />
                {DOW[i]}요일
              </label>
              {r.enabled ? (
                <div className="times">
                  <Input type="time" aria-label={`${DOW[i]}요일 시작`} value={r.open} onChange={(e) => setRow(i, { open: e.target.value })} disabled={dis} required />
                  <span>~</span>
                  <Input type="time" aria-label={`${DOW[i]}요일 마감`} value={r.close} onChange={(e) => setRow(i, { close: e.target.value })} disabled={dis} required />
                  {r.breaks.map((b, bi) => (
                    <span key={bi} className="times" style={{ gap: 6 }}>
                      <span className="muted">휴게</span>
                      <Input type="time" aria-label="휴게 시작" value={b.start} onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, start: e.target.value } : x)) })} disabled={dis} />
                      <span>~</span>
                      <Input type="time" aria-label="휴게 끝" value={b.end} onChange={(e) => setRow(i, { breaks: r.breaks.map((x, k) => (k === bi ? { ...x, end: e.target.value } : x)) })} disabled={dis} />
                      <Button type="button" size="sm" onClick={() => setRow(i, { breaks: r.breaks.filter((_, k) => k !== bi) })} disabled={dis} aria-label="휴게시간 삭제">
                        ✕
                      </Button>
                    </span>
                  ))}
                  {r.breaks.length < 2 && (
                    <Button type="button" size="sm" onClick={() => setRow(i, { breaks: [...r.breaks, { start: "13:00", end: "14:00" }] })} disabled={dis}>
                      + 휴게시간
                    </Button>
                  )}
                </div>
              ) : (
                <span className="closed">휴무</span>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="actions">
            <Button type="submit" variant="primary" loading={busy}>
              {mode === "wizard" ? "저장하고 다음" : "저장"}
            </Button>
            {mode === "wizard" && (
              <Button type="button" onClick={() => router.push("/console/onboarding/2")}>
                건너뛰기
              </Button>
            )}
          </div>
        )}
      </form>

      <section className="panel">
        <h2>공개 주소</h2>
        <p className="sub">
          고객이 예약하러 오는 주소입니다. 영소문자·숫자·하이픈 3~30자. <b>한 번 쓴 주소는 바꾼 뒤에도 다른 사업장이 쓸 수 없고</b>, 옛 주소로 들어온 손님은 새 주소로 안내됩니다.
        </p>
        {slugMsg && <Alert kind={slugMsg.kind}>{slugMsg.text}</Alert>}
        <Field label="주소" htmlFor="b-slug" hint={savedSlug.startsWith("b-") ? (mode === "wizard" ? "아직 임시 주소입니다 — 주소까지 정해야 1단계가 완료돼요" : "아직 임시 주소입니다 — 정해 주세요") : `현재: ${publicBase}/@${savedSlug}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ whiteSpace: "nowrap", fontSize: 13 }}>{publicBase.replace(/^https?:\/\//, "")}/@</span>
            <Input id="b-slug" style={{ flex: 1, minWidth: 160 }} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} disabled={readOnly || slugBusy} placeholder="my-salon" pattern="[a-z0-9-]{3,30}" />
            {!readOnly && (
              <Button type="button" onClick={saveSlug} loading={slugBusy} disabled={!slug || slug === savedSlug}>
                주소 저장
              </Button>
            )}
          </div>
        </Field>
      </section>
    </div>
  );
}
