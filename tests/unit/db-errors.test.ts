import { afterEach, describe, expect, it } from "vitest";
import { ddlDbUrl, explainDbError, runtimeDbUrl } from "../../scripts/db/_conn";

/**
 * `explainDbError` 는 CLI 스크립트가 실패했을 때 **왜** 실패했는지를 말하는 유일한 자리다.
 *
 * 이 파일이 있는 이유는 같은 실수를 세 번 저질렀기 때문이다:
 *   1) drizzle 이 pg 오류를 `DrizzleQueryError` 로 감싸 원인이 `cause` 에만 있는데 겉만 찍었다
 *      → "Failed query: select …" 만 남고 이유가 통째로 사라졌다
 *   2) 그걸 고치면서 무엇이든 `describeConnError` 로 넘겨, **연결 문제가 아닌 것에도**
 *      "DB 연결 실패" 라벨이 붙었다
 *   3) 진단 주소를 이 함수가 직접 골라(`DATABASE_URL_UNPOOLED` 우선), 정작 스크립트가 연결한
 *      주소(`DATABASE_URL`)와 다른 호스트를 가리켰다 — 오진단이 형태만 바꿔 재발했다
 * 두 스크립트가 이 함수 하나를 쓰므로 한쪽만 고쳐지는 드리프트도 여기서 막힌다.
 */
const wrap = (cause: unknown) => Object.assign(new Error("Failed query: select ..."), { cause });
const pgErr = (code: string, message: string) => Object.assign(new Error(message), { code });

const POOLED = "postgresql://u:p@ep-x-pooler.example.neon.tech/majubom";
const DIRECT = "postgresql://u:p@ep-x.example.neon.tech/majubom";

describe("explainDbError", () => {
  it("주소가 비어 있으면 그것부터 말한다 — 다른 진단은 의미가 없다", () => {
    expect(explainDbError(wrap(pgErr("ECONNREFUSED", "connect ECONNREFUSED")), "")).toContain("DATABASE_URL 이 없다");
  });

  it("어느 변수가 비었는지는 호출자가 정한다 — 마이그레이션은 직결 주소를 본다", () => {
    expect(explainDbError(new Error("무엇이든"), "", "DATABASE_URL_UNPOOLED")).toContain("DATABASE_URL_UNPOOLED 이 없다");
  });

  it("drizzle 이 감싼 연결 오류를 cause 에서 꺼낸다", () => {
    const m = explainDbError(wrap(pgErr("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")), POOLED);
    expect(m).toContain("DB 연결 실패");
    expect(m, "겉 message 만 찍히면 이유가 사라진다").not.toBe("Failed query: select ...");
  });

  it("호출자가 준 주소의 호스트를 그대로 말한다 — 실제로 연결한 곳과 달라지면 그게 오진단이다", () => {
    const m = explainDbError(wrap(pgErr("ENOTFOUND", "getaddrinfo ENOTFOUND")), POOLED);
    expect(m).toContain("ep-x-pooler.example.neon.tech");
    expect(m, "직결 호스트를 가리키면 엉뚱한 곳을 고치게 된다").not.toContain(new URL(DIRECT).host);
  });

  it("ECONNREFUSED ×2 (IPv4·IPv6) 는 AggregateError 다 — message 가 비어 '실패:' 만 찍혔었다", () => {
    const agg = new AggregateError([pgErr("ECONNREFUSED", "connect ECONNREFUSED ::1:5432"), pgErr("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")]);
    expect(explainDbError(wrap(agg), POOLED)).toContain("ECONNREFUSED");
  });

  it("표가 없는 것과 DB 가 없는 것은 연결 문제가 아니다 — 각각의 다음 수를 알려 준다", () => {
    const t = explainDbError(wrap(pgErr("42P01", 'relation "users" does not exist')), POOLED);
    expect(t).toContain("db:migrate");
    expect(t, "연결 문제로 오진단하면 안 된다").not.toContain("DB 연결 실패");

    const d = explainDbError(wrap(pgErr("3D000", 'database "nope" does not exist')), POOLED);
    expect(d).toContain("DATABASE_URL 의 마지막 경로");
    expect(d).not.toContain("DB 연결 실패");
  });

  it("아는 코드가 아닌 Postgres 오류는 코드와 원문을 그대로 준다", () => {
    const m = explainDbError(wrap(pgErr("23505", "duplicate key value violates unique constraint")), POOLED);
    expect(m).toContain("23505");
    expect(m).toContain("duplicate key");
    expect(m).not.toContain("DB 연결 실패");
  });

  it("DB 와 무관한 오류에는 연결 실패 라벨을 붙이지 않는다 — 지어내지 말고 사슬을 보여 준다", () => {
    const m = explainDbError(new Error("이메일 형식이 아닙니다"), POOLED);
    expect(m).toBe("이메일 형식이 아닙니다");
    expect(m).not.toContain("DB 연결 실패");
  });

  it("원인 사슬이 여러 겹이면 이어서 보여 준다", () => {
    expect(explainDbError(wrap(new Error("바깥 이유")), POOLED)).toContain("바깥 이유");
  });
});

/**
 * 주소를 고르는 자리도 한 곳뿐이어야 한다. 런타임 스크립트(admin:create 등)는 `src/db/client.ts`
 * 의 풀로 붙고, 그 풀은 `DATABASE_URL` **하나만** 본다 — 진단이 `DATABASE_URL_UNPOOLED` 로
 * 흘러가면 실패 메시지가 접속하지도 않은 호스트를 가리킨다.
 */
describe("어느 주소로 붙었는지", () => {
  const saved = { url: process.env.DATABASE_URL, unpooled: process.env.DATABASE_URL_UNPOOLED };
  afterEach(() => {
    for (const [k, v] of [["DATABASE_URL", saved.url], ["DATABASE_URL_UNPOOLED", saved.unpooled]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("런타임 풀은 DATABASE_URL 만 본다 — UNPOOLED 가 있어도 넘어가지 않는다", () => {
    process.env.DATABASE_URL = POOLED;
    process.env.DATABASE_URL_UNPOOLED = DIRECT;
    expect(runtimeDbUrl()).toBe(POOLED);
  });

  it("DDL 직결은 UNPOOLED 를 먼저 본다 (Neon PgBouncer 는 SET 을 못 받는다)", () => {
    process.env.DATABASE_URL = POOLED;
    process.env.DATABASE_URL_UNPOOLED = DIRECT;
    expect(ddlDbUrl()).toBe(DIRECT);
  });

  it("UNPOOLED 가 없으면 DDL 도 DATABASE_URL 로 물러난다", () => {
    process.env.DATABASE_URL = POOLED;
    delete process.env.DATABASE_URL_UNPOOLED;
    expect(ddlDbUrl()).toBe(POOLED);
  });
});
