import { describe, expect, it } from "vitest";
import { REDACTED, scrubBreadcrumb, scrubEvent, scrubString, scrubValue } from "./sentry-scrub";

describe("scrubString", () => {
  it("이메일 패턴을 지운다", () => {
    expect(scrubString("문의: hong.gildong+test@example.co.kr 로")).toBe(`문의: ${REDACTED} 로`);
  });

  it("한국 휴대폰 번호를 하이픈 유무와 무관하게 지운다", () => {
    expect(scrubString("010-1234-5678")).toBe(REDACTED);
    expect(scrubString("01012345678")).toBe(REDACTED);
    expect(scrubString("011-123-4567")).toBe(REDACTED);
    expect(scrubString("연락처 0161234567 입니다")).toBe(`연락처 ${REDACTED} 입니다`);
  });

  it("PII 가 없는 문자열은 그대로 둔다", () => {
    expect(scrubString("예약 12건, 2026-09-07")).toBe("예약 12건, 2026-09-07");
    expect(scrubString("02-123-4567")).toBe("02-123-4567"); // 유선번호는 대상 아님
  });
});

describe("scrubEvent", () => {
  it("Authorization · Cookie 헤더와 PII 키를 [redacted] 로 바꾼다", () => {
    const event = {
      message: "boom",
      request: {
        url: "https://majubom.kr/api/reservations",
        headers: {
          Authorization: "Bearer eyJhbGciOi...",
          cookie: "session=abc; theme=dark",
          "set-cookie": "session=def",
          "content-type": "application/json",
        },
        data: { phone: "010-9999-8888", email: "a@b.com", fcmToken: "fcm:xyz", note: "창가 자리" },
      },
      user: { id: "u_1", email: "user@example.com", ip_address: "1.2.3.4" },
    };

    const out = scrubEvent(event);

    expect(out.request.headers.Authorization).toBe(REDACTED);
    expect(out.request.headers.cookie).toBe(REDACTED);
    expect(out.request.headers["set-cookie"]).toBe(REDACTED);
    expect(out.request.headers["content-type"]).toBe("application/json");
    expect(out.request.data.phone).toBe(REDACTED);
    expect(out.request.data.email).toBe(REDACTED);
    expect(out.request.data.fcmToken).toBe(REDACTED);
    expect(out.request.data.note).toBe("창가 자리");
    expect(out.user.email).toBe(REDACTED);
    expect(out.user.id).toBe("u_1");
    // 원본은 변경하지 않는다
    expect(event.request.headers.Authorization).toBe("Bearer eyJhbGciOi...");
  });

  it("예외 메시지·스택 안의 이메일과 전화번호를 지운다", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "user kim@nts-corp.com (010-1111-2222) not found",
            stacktrace: { frames: [{ filename: "app.ts", vars: { q: "010 1111 2222" } }] },
          },
        ],
      },
      extra: { payload: JSON.stringify({ email: "x@y.io", phone: "01055556666" }) },
    };

    const out = scrubEvent(event);
    expect(out.exception.values[0].value).toBe(`user ${REDACTED} (${REDACTED}) not found`);
    expect(out.exception.values[0].stacktrace.frames[0].vars.q).toBe(REDACTED);
    expect(out.extra.payload).not.toContain("x@y.io");
    expect(out.extra.payload).not.toContain("01055556666");
  });
});

describe("scrubBreadcrumb", () => {
  it("브레드크럼 message · data 를 스크러빙한다", () => {
    const crumb = {
      category: "fetch",
      message: "POST /api/login for someone@example.com",
      data: {
        url: "/api/login?phone=010-2222-3333",
        method: "POST",
        headers: { Cookie: "a=b" },
        body: { phone: "01022223333", password: "hunter2" },
      },
    };

    const out = scrubBreadcrumb(crumb);
    expect(out.message).toBe(`POST /api/login for ${REDACTED}`);
    expect(out.data.url).toBe(`/api/login?phone=${REDACTED}`);
    expect(out.data.method).toBe("POST");
    expect(out.data.headers.Cookie).toBe(REDACTED);
    expect(out.data.body.phone).toBe(REDACTED);
    expect(out.data.body.password).toBe(REDACTED);
  });
});

describe("scrubValue 안전성", () => {
  it("순환 참조와 배열을 처리한다", () => {
    const a: Record<string, unknown> = { list: ["010-0000-1111", { email: "z@z.kr" }] };
    a.self = a;
    const out = scrubValue(a) as { list: unknown[]; self: unknown };
    expect(out.list[0]).toBe(REDACTED);
    expect((out.list[1] as { email: string }).email).toBe(REDACTED);
    expect(out.self).toBe("[circular]");
  });

  it("null · 숫자 · 불리언은 그대로 둔다", () => {
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue({ phone: null })).toEqual({ phone: null });
  });
});
