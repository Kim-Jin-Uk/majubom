import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `apphosting.yaml` 이 App Hosting 파서를 통과하는 모양인지.
 *
 * 이 검사가 있는 이유: `NEXT_PUBLIC_FIREBASE_API_KEY: value: ""` 한 줄 때문에 저장소 초기화(9/4)부터
 * **모든 롤아웃이 빌드 첫 단계에서 죽고 있었다**. 파서는 빈 문자열을 "값 없음" 으로 보고
 * `fah/invalid-apphosting-yaml` 로 거부하는데, 실패가 Cloud Build 로그 안에만 남아서
 * 로컬 `npm run verify` 도 `next build` 도 멀쩡히 통과했다 — 5일 동안 아무도 몰랐다.
 *
 * 그래서 배포 설정도 테스트로 묶는다. YAML 라이브러리를 쓰지 않고 직접 읽는 이유는
 * `yaml` 이 우리 의존성이 아니라 전이 의존성이기 때문이고, 이 파일의 모양이 단순해서 그래도 되기 때문이다.
 * 모양이 예상과 다르면(들여쓰기·주석 스타일) 파서가 조용히 넘어가지 않고 그 줄에서 실패한다.
 */

type Entry = { line: number; variable: string; keys: Record<string, string> };

function parseEnv(text: string): Entry[] {
  const lines = text.split("\n");
  const out: Entry[] = [];
  let inEnv = false;
  let cur: Entry | null = null;
  for (const [i, raw] of lines.entries()) {
    if (/^env:\s*$/.test(raw)) {
      inEnv = true;
      continue;
    }
    // 최상위 키가 다시 나오면 env 블록이 끝난 것
    if (inEnv && /^\S/.test(raw)) inEnv = false;
    if (!inEnv) continue;
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    // 값 뒤에 붙은 주석은 떼되, 값 안의 '#' 은 건드리지 않도록 공백이 앞선 것만
    const body = raw.replace(/\s+#.*$/, "").trimEnd();
    if (body.trim() === "") continue;
    const head = /^\s*-\s*variable:\s*(\S+)\s*$/.exec(body);
    if (head) {
      cur = { line: i + 1, variable: head[1], keys: {} };
      out.push(cur);
      continue;
    }
    const kv = /^\s+(\w+):\s*(.*)$/.exec(body);
    expect(kv, `apphosting.yaml:${i + 1} 예상치 못한 줄 — ${raw}`).not.toBeNull();
    if (kv && cur) cur.keys[kv[1]] = kv[2].trim();
  }
  return out;
}

const yaml = readFileSync("apphosting.yaml", "utf8");
const entries = parseEnv(yaml);

describe("apphosting.yaml", () => {
  it("env 항목을 읽어낸다", () => {
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.map((e) => e.variable)).toContain("DATABASE_URL");
  });

  it("모든 항목에 value 나 secret 이 있고, value 는 비어 있지 않다", () => {
    const bad = entries.filter((e) => {
      const v = e.keys.value;
      const hasValue = v !== undefined && v !== '""' && v !== "''" && v !== "";
      return !hasValue && e.keys.secret === undefined;
    });
    // 빈 문자열은 App Hosting 파서에게 "값 없음" 이다 — 지우거나 실제 값을 넣는다
    expect(bad.map((e) => `${e.variable} (line ${e.line})`), "value 가 비었거나 secret 도 없는 항목").toEqual([]);
  });

  it("value 와 secret 을 동시에 갖지 않는다", () => {
    const both = entries.filter((e) => e.keys.value !== undefined && e.keys.secret !== undefined);
    expect(both.map((e) => e.variable)).toEqual([]);
  });

  /**
   * 선언된 시크릿 목록을 **정확히** 고정한다. 빠지면 기능이 죽고, 늘어나면 배포가 죽는다 —
   * 선언만 해 두고 Secret Manager 에 안 만들면 `fah/misconfigured-secret` 으로 빌드가 통째로 실패하는데,
   * 그 실패는 Cloud Build 로그 안에만 남는다(실제로 그렇게 5일을 잃었다).
   * 이 목록에 한 줄 더할 때는 `firebase apphosting:secrets:set <이름>` 도 같이 하는 것이 규약이다.
   */
  it("선언된 시크릿이 정확히 이 목록이다", () => {
    const expected = ["DATABASE_URL", "AUTH_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "RESEND_API_KEY", "CRON_SECRET"];
    const declared = entries.filter((e) => e.keys.secret !== undefined).map((e) => e.variable);
    expect(declared.slice().sort(), "Secret Manager 에 실제로 만들어 둔 것과 같아야 한다").toEqual(expected.slice().sort());
  });

  it("시크릿 이름과 변수 이름이 같다 — 다르면 어느 쪽을 만들어야 하는지 헷갈린다", () => {
    const mismatched = entries.filter((e) => e.keys.secret !== undefined && e.keys.secret !== e.variable);
    expect(mismatched.map((e) => `${e.variable} → ${e.keys.secret}`)).toEqual([]);
  });

  it("R2 다섯 값이 세트로 있다 — env 검증이 짝을 요구한다", () => {
    const names = entries.map((e) => e.variable);
    for (const k of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_PUBLIC_BASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) expect(names, k).toContain(k);
  });
});
