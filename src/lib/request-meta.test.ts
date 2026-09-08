import { describe, expect, it } from "vitest";
import { deviceLabel, normalizeIp, requestMeta } from "./request-meta";

describe("normalizeIp", () => {
  it("x-forwarded-for 는 오른쪽(프록시가 붙인 값) 기준 · 신뢰 홉 수 건너뛰기 · IPv4-mapped · 쓰레기 거부", () => {
    // 클라이언트가 왼쪽에 위조값을 넣어도 오른쪽 값이 이긴다
    expect(normalizeIp("1.2.3.4, 203.0.113.9", 0)).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9, 10.0.0.1", 1)).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9", 1)).toBeNull(); // 홉 수보다 짧으면 알 수 없음
    expect(normalizeIp("::ffff:203.0.113.9", 0)).toBe("203.0.113.9");
    expect(normalizeIp("2001:db8::1", 0)).toBe("2001:db8::1");
    expect(normalizeIp("999.1.1.1", 0)).toBeNull();
    expect(normalizeIp("zzz", 0)).toBeNull();
    expect(normalizeIp("'; DROP TABLE users; --", 0)).toBeNull();
    expect(normalizeIp(null)).toBeNull();
  });
  it("requestMeta 는 UA 를 512 자로 자른다", () => {
    const h = new Headers({ "user-agent": "x".repeat(1000), "x-forwarded-for": "198.51.100.2" });
    const m = requestMeta(h);
    expect(m.ip).toBe("198.51.100.2");
    expect(m.userAgent?.length).toBe(512);
  });
  it("deviceLabel", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")).toBe("Chrome · macOS");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(deviceLabel(null)).toBeNull();
  });
});
