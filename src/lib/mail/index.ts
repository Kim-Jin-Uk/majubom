import { Resend } from "resend";
import { serverEnv } from "@/lib/env";

/**
 * 메일 발송 (06 §3 — Resend, 무료 3,000통/월).
 *
 * - RESEND_API_KEY 가 없으면 콘솔에 찍고 성공으로 처리한다 (로컬·CI). 링크·OTP 가 로그에 남으므로 프로덕션에서는
 *   키가 반드시 있어야 한다 — env 스키마가 production 에서 키 없음을 거부한다.
 * - 수신자 주소를 로그에 남기지 않는다 (FR-PRIV-010). 개발 폴백만 예외.
 * - 템플릿은 ./templates.ts. 여기는 전송만.
 */
export type Mail = { to: string; subject: string; text: string; html?: string };

let client: Resend | undefined;

export async function sendMail(mail: Mail): Promise<{ id: string | null; delivered: boolean }> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) {
    console.info(`[mail:dev] to=${mail.to}\n  subject=${mail.subject}\n${indent(mail.text)}`);
    return { id: null, delivered: false };
  }
  client ??= new Resend(env.RESEND_API_KEY);
  const { data, error } = await client.emails.send({
    from: env.MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if (error) throw new Error(`메일 발송 실패: ${error.name} ${error.message}`);
  return { id: data?.id ?? null, delivered: true };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}
