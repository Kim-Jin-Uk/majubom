import { Resend, type CreateEmailRequestOptions } from "resend";
import { serverEnv } from "@/lib/env";

/**
 * 메일 발송 (06 §3 — Resend, 무료 3,000통/월).
 *
 * - RESEND_API_KEY 가 없으면 콘솔에 찍고 성공으로 처리한다 (로컬·CI). 링크·OTP 가 로그에 남으므로 프로덕션에서는
 *   키가 반드시 있어야 한다 — env 스키마가 production 에서 키 없음을 거부한다.
 * - 수신자 주소를 로그에 남기지 않는다 (FR-PRIV-010). 개발 폴백만 예외.
 * - 템플릿은 ./templates.ts. 여기는 전송만.
 * - **왕복에 상한이 있다** (아래 `SEND_TIMEOUT_MS`).
 */
export type Mail = { to: string; subject: string; text: string; html?: string };

let client: Resend | undefined;

/**
 * 메일 한 통의 왕복 상한.
 *
 * Resend SDK 도 그 안의 `fetch` 도 타임아웃이 없다 — 응답이 늦으면 호출부가 **예외가 아니라 행(hang)** 으로 걸린다.
 * 커밋 뒤에 보내므로 예약은 이미 확정돼 있지만, 배치(`expireRequests`)는 한 묶음 8통을 `Promise.all` 로 기다리고
 * 가입·초대·재설정은 사용자가 응답을 기다리는 요청 경로다. 늦으면 던지는 편이 낫다 — 호출부는 이미 실패를 다룬다.
 *
 * 10초는 Resend 정상 응답(수백 ms)의 한참 위이면서, 5분 주기 배치(C2)를 넘기지 않는 값이다.
 */
const SEND_TIMEOUT_MS = 10_000;

/**
 * 타임아웃을 fetch 까지 내려보낸다.
 *
 * SDK 의 `CreateEmailRequestOptions` 에는 `signal` 이 없지만, `Resend#post` 가 이 객체를 그대로
 * fetch init 으로 펼친다(`{ method, body, ...options, headers }` — resend 6.26 `dist/index.mjs`).
 * 타입에 없는 통로라 `timeout.test.ts` 가 signal 이 실제 `fetch` 까지 닿는지 직접 본다 —
 * SDK 가 이 동작을 바꾸면 메일이 조용히 무한 대기로 돌아가는 대신 그 테스트가 먼저 깨진다.
 */
function timeoutOption(signal: AbortSignal): CreateEmailRequestOptions {
  return { signal } as unknown as CreateEmailRequestOptions;
}

export async function sendMail(mail: Mail): Promise<{ id: string | null; delivered: boolean }> {
  // 키 유무만 보는 데 전체 env 검증을 걸지 않는다 — AUTH_SECRET 이 없는 CI·테스트에서
  // 콘솔 폴백까지 예외가 되면, 메일을 보내는 코드 경로가 통째로 테스트에서 빠진다
  if (!process.env.RESEND_API_KEY) {
    console.info(`[mail:dev] to=${mail.to}\n  subject=${mail.subject}\n${indent(mail.text)}`);
    return { id: null, delivered: false };
  }
  const env = serverEnv();
  client ??= new Resend(env.RESEND_API_KEY);
  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const { data, error } = await client.emails.send(
    {
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
    timeoutOption(signal),
  );
  // SDK 는 fetch 거절(끊김·DNS·abort)을 전부 삼켜 "Unable to fetch data." 하나로 돌려준다 —
  // 시한 때문인지 아닌지는 우리 signal 만 안다. 로그에서 원인이 갈리도록 여기서 나눈다
  if (error && signal.aborted) throw new Error(`메일 발송 실패: ${SEND_TIMEOUT_MS}ms 안에 Resend 가 응답하지 않았다`);
  if (error) throw new Error(`메일 발송 실패: ${error.name} ${error.message}`);
  return { id: data?.id ?? null, delivered: true };
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}
