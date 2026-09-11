import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { sendMail } from ".";

/**
 * `sendMail` 의 왕복 상한이 **실제 fetch 까지 닿는지** 본다.
 *
 * Resend SDK 의 `CreateEmailRequestOptions` 타입에는 `signal` 이 없다 — 우리는 `Resend#post` 가
 * 옵션 객체를 fetch init 으로 그대로 펼친다는 구현에 기대고 있다. 타입이 지켜 주지 않는 통로라
 * 여기서 직접 확인한다. SDK 가 그 동작을 바꾸면 메일은 조용히 무한 대기로 돌아가는데,
 * 그전에 이 파일이 깨져야 한다.
 *
 * 시한이 실제로 만료되는 것까지는 보지 않는다 — `AbortSignal.timeout` 은 vitest 의 가짜 타이머를
 * 따르지 않아(확인함) 10초를 진짜로 기다려야 한다. signal 이 살아서 fetch 에 닿으면 끊는 일은 런타임 몫이다.
 */
const MAIL = { to: "a@b.c", subject: "제목", text: "본문" };

const ok = () => new Response(JSON.stringify({ id: "mail_1" }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/majubom_test");
  vi.stubEnv("AUTH_SECRET", "x".repeat(32));
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  resetServerEnvCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("sendMail 타임아웃", () => {
  it("fetch 가 아직 끊기지 않은 signal 을 받는다 — SDK 가 옵션을 삼키면 여기서 깨진다", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await expect(sendMail(MAIL)).resolves.toEqual({ id: "mail_1", delivered: true });

    const signal = spy.mock.calls[0]?.[1]?.signal;
    expect(signal, "signal 이 fetch 까지 가지 않았다 — resend 의 옵션 전달 방식이 바뀌었다").toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("시한은 통마다 새로 잡는다 — 한 번 만료된 signal 을 돌려쓰면 이후 발송이 전부 죽는다", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok());

    await sendMail(MAIL);
    await sendMail(MAIL);

    const [first, second] = spy.mock.calls.map(([, init]) => init?.signal);
    expect(first).not.toBe(second);
  });
});
