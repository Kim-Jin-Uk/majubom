import { z } from "zod";

/** FR-AUTH-010: 8자 이상 영문+숫자. 상한은 scrypt 입력 폭주 방지 */
export const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다")
  .max(128, "비밀번호는 128자 이하여야 합니다")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "영문과 숫자를 모두 포함해야 합니다");

export const emailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email("이메일 형식이 아닙니다"));

export const nameSchema = z.string().trim().min(1, "이름을 입력해 주세요").max(100);

/** 한국 휴대폰·유선 번호. 하이픈·공백은 제거해 저장 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^0\d{8,10}$/, "연락처 형식이 아닙니다"));

/** 사업자등록번호 10자리 (하이픈 허용, 제거해 저장). 체크섬은 국세청 규칙 */
export const bizRegNoSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/-/g, ""))
  .pipe(z.string().regex(/^\d{10}$/, "사업자등록번호는 숫자 10자리입니다"))
  .refine(validBizRegNo, "사업자등록번호가 올바르지 않습니다");

export function validBizRegNo(n: string): boolean {
  if (!/^\d{10}$/.test(n)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(n[i]) * w[i];
  sum += Math.floor((Number(n[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(n[9]);
}

export const otpSchema = z.string().regex(/^\d{6}$/, "인증번호는 숫자 6자리입니다");
