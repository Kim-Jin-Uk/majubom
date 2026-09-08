"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { BUSINESS_CATEGORIES } from "@/features/business/policy-defaults";
import { apiPost, describeError, fieldErrors } from "@/lib/client-api";
import { hardNavigate } from "./safe-next";

const EMPTY = { businessName: "", bizRegNo: "", category: "", address: "", addressDetail: "", ownerName: "", phone: "", email: "", password: "", confirm: "" };

/**
 * FR-AUTH-010 사업자 가입 신청. 제출 → OTP 메일 → /signup/business/verify.
 * account 가 있으면(로그인한 고객) 그 계정으로 신청 — 이메일·비밀번호 칸 없음. 없으면 이메일·비밀번호를 받고,
 * 이미 가입된 이메일이면 서버가 비밀번호로 본인을 확인해 그 계정에 사업장을 붙인다.
 */
export function BusinessSignupForm({ account }: { account: { email: string; name: string } | null }) {
  const [form, setForm] = useState({ ...EMPTY, email: account?.email ?? "", ownerName: account?.name ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErrors({});
    if (!account && form.password !== form.confirm) return setErrors({ confirm: "비밀번호가 서로 다릅니다" });
    setBusy(true);
    // confirm 은 클라이언트 검증용 — 서버 스키마에 없는 키는 보내지 않는다
    const payload = {
      businessName: form.businessName,
      bizRegNo: form.bizRegNo,
      category: form.category,
      address: form.address,
      addressDetail: form.addressDetail || undefined,
      ownerName: form.ownerName,
      phone: form.phone,
      email: form.email,
      ...(account ? {} : { password: form.password }),
    };
    const r = await apiPost("/api/auth/business-signup", payload);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "EMAIL_TAKEN_PASSWORD_MISMATCH") setErrors({ password: "이미 가입된 이메일입니다. 그 계정의 비밀번호를 입력하면 같은 계정으로 사업자 신청이 됩니다" });
      else if (r.error === "EMAIL_TAKEN_LOGIN_REQUIRED") setErrors({ email: "소셜 계정으로 가입된 이메일입니다. 로그인한 뒤 사업자 신청을 해 주세요" });
      else if (r.error === "ALREADY_MEMBER") setErrors({ email: "이미 사업장에 소속된 계정입니다 (계정당 사업장 1개)" });
      else if (r.error === "EMAIL_TAKEN") setErrors({ email: "사용할 수 없는 이메일입니다" });
      else if (r.error === "BIZ_REG_NO_TAKEN") setErrors({ bizRegNo: "이미 등록된 사업자번호입니다" });
      else if (r.issues) setErrors(fieldErrors(r.issues));
      else setMsg(describeError(r));
      return;
    }
    hardNavigate(`/signup/business/verify?email=${encodeURIComponent(form.email)}`);
  }

  return (
    <>
      <h1>사업자 가입 신청</h1>
      <p className="sub">심사(1영업일) 중에도 콘솔은 바로 열립니다. 매장·자원·상품을 준비해 두면 승인 즉시 예약 페이지가 공개돼요.</p>
      {msg && <Alert kind="error">{msg}</Alert>}
      <form className="form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <Field label="상호" htmlFor="businessName" error={errors.businessName}>
          <Input id="businessName" required maxLength={100} value={form.businessName} onChange={set("businessName")} aria-invalid={!!errors.businessName} />
        </Field>
        <div className="row">
          <Field label="사업자등록번호" htmlFor="bizRegNo" error={errors.bizRegNo} hint="숫자 10자리">
            <Input id="bizRegNo" inputMode="numeric" placeholder="000-00-00000" required value={form.bizRegNo} onChange={set("bizRegNo")} aria-invalid={!!errors.bizRegNo} />
          </Field>
          <Field label="업종" htmlFor="category" error={errors.category}>
            <select id="category" className="input" required value={form.category} onChange={set("category")} aria-invalid={!!errors.category}>
              <option value="" disabled>
                선택
              </option>
              {BUSINESS_CATEGORIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="주소" htmlFor="address" error={errors.address}>
          <Input id="address" required maxLength={300} value={form.address} onChange={set("address")} aria-invalid={!!errors.address} />
        </Field>
        <Field label="상세 주소" htmlFor="addressDetail" error={errors.addressDetail}>
          <Input id="addressDetail" maxLength={200} value={form.addressDetail} onChange={set("addressDetail")} />
        </Field>
        <div className="row">
          <Field label="대표자명" htmlFor="ownerName" error={errors.ownerName}>
            <Input id="ownerName" required autoComplete="name" value={form.ownerName} onChange={set("ownerName")} aria-invalid={!!errors.ownerName} />
          </Field>
          <Field label="연락처" htmlFor="phone" error={errors.phone}>
            <Input id="phone" type="tel" required autoComplete="tel" placeholder="010-0000-0000" value={form.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
          </Field>
        </div>
        {account ? (
          <Alert kind="info">
            현재 로그인한 계정 <b>{account.email}</b> 으로 신청합니다. 고객 예약과 사업장 콘솔을 한 계정으로 씁니다.
          </Alert>
        ) : (
          <>
            <Field label="이메일" htmlFor="email" error={errors.email} hint="인증번호를 이 주소로 보내드려요. 이미 고객으로 가입한 이메일이면 그 비밀번호를 넣으세요 — 같은 계정으로 사업자가 됩니다.">
              <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
            </Field>
            <div className="row">
              <Field label="비밀번호" htmlFor="password" error={errors.password} hint="8자 이상, 영문과 숫자 포함">
                <Input id="password" type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} aria-invalid={!!errors.password} />
              </Field>
              <Field label="비밀번호 확인" htmlFor="confirm" error={errors.confirm}>
                <Input id="confirm" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} aria-invalid={!!errors.confirm} />
              </Field>
            </div>
          </>
        )}
        <Button type="submit" variant="primary" block loading={busy}>
          인증번호 받기
        </Button>
      </form>
      <div className="links">
        <Link href="/login">이미 계정이 있어요</Link>
        <Link href="/signup">고객으로 가입</Link>
      </div>
    </>
  );
}
