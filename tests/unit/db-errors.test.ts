import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explainDbError } from "../../scripts/db/_conn";

/**
 * `explainDbError` 는 CLI 스크립트가 실패했을 때 **왜** 실패했는지를 말하는 유일한 자리다.
 *
 * 이 파일이 있는 이유는 두 가지 실수를 각각 한 번씩 저질렀기 때문이다:
 *   1) drizzle 이 pg 오류를 `DrizzleQueryError` 로 감싸 원인이 `cause` 에만 있는데 겉만 찍었다
 *      → "Failed query: select …" 만 남고 이유가 통째로 사라졌다
 *   2) 그걸 고치면서 무엇이든 `describeConnError` 로 넘겨, **연결 문제가 아닌 것에도**
 *      "DB 연결 실패" 라벨이 붙었다
 * 두 스크립트가 이 함수 하나를 쓰므로 한쪽만 고쳐지는 드리프트도 여기서 막힌다.
 */
const wrap = (cause: unknown) => Object.assign(new Error("Failed query: select ..."), { cause });
const pgErr = (code: string, message: string) => Object.assign(new Error(message), { code });

let saved: { url?: string; unpooled?: string };
beforeEach(() => {
  saved = { url: process.env.DATABASE_URL, unpooled: process.env.DATABASE_URL_UNPOOLED };
  process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/majubom_test";
  delete process.env.DATABASE_URL_UNPOOLED;
});
afterEach(() => {
  if (saved.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.url;
  if (saved.unpooled !== undefined) process.env.DATABASE_URL_UNPOOLED = saved.unpooled;
});

describe("explainDbError", () => {
  it("DATABASE_URL 이 없으면 그것부터 말한다 — 다른 진단은 의미가 없다", () => {
    delete process.env.DATABASE_URL;
    expect(explainDbError(wrap(pgErr("ECONNREFUSED", "connect ECONNREFUSED")))).toContain("DATABASE_URL 이 없다");
  });

  it("drizzle 이 감싼 연결 오류를 cause 에서 꺼낸다", () => {
    const m = explainDbError(wrap(pgErr("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")));
    expect(m).toContain("DB 연결 실패");
    expect(m, "겉 message 만 찍히면 이유가 사라진다").not.toBe("Failed query: select ...");
  });

  it("ECONNREFUSED ×2 (IPv4·IPv6) 는 AggregateError 다 — message 가 비어 '실패:' 만 찍혔었다", () => {
    const agg = new AggregateError([pgErr("ECONNREFUSED", "connect ECONNREFUSED ::1:5432"), pgErr("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")]);
    expect(explainDbError(wrap(agg))).toContain("ECONNREFUSED");
  });

  it("표가 없는 것과 DB 가 없는 것은 연결 문제가 아니다 — 각각의 다음 수를 알려 준다", () => {
    const t = explainDbError(wrap(pgErr("42P01", 'relation "users" does not exist')));
    expect(t).toContain("db:migrate");
    expect(t, "연결 문제로 오진단하면 안 된다").not.toContain("DB 연결 실패");

    const d = explainDbError(wrap(pgErr("3D000", 'database "nope" does not exist')));
    expect(d).toContain("DATABASE_URL 의 마지막 경로");
    expect(d).not.toContain("DB 연결 실패");
  });

  it("아는 코드가 아닌 Postgres 오류는 코드와 원문을 그대로 준다", () => {
    const m = explainDbError(wrap(pgErr("23505", "duplicate key value violates unique constraint")));
    expect(m).toContain("23505");
    expect(m).toContain("duplicate key");
    expect(m).not.toContain("DB 연결 실패");
  });

  it("DB 와 무관한 오류에는 연결 실패 라벨을 붙이지 않는다 — 지어내지 말고 사슬을 보여 준다", () => {
    const m = explainDbError(new Error("이메일 형식이 아닙니다"));
    expect(m).toBe("이메일 형식이 아닙니다");
    expect(m).not.toContain("DB 연결 실패");
  });

  it("원인 사슬이 여러 겹이면 이어서 보여 준다", () => {
    expect(explainDbError(wrap(new Error("바깥 이유")))).toContain("바깥 이유");
  });
});
