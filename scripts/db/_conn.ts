import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: [".env.local", ".env"], quiet: true });

/** DDL 전용 직결 클라이언트. lock_timeout 을 세션에 강제한다 (08 §5.5). */
export async function ddlClient() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (또는 DATABASE_URL) 가 없다");
  if (/pooler\./.test(url)) {
    throw new Error("마이그레이션은 pooled 엔드포인트로 돌리지 않는다. DATABASE_URL_UNPOOLED 를 쓸 것 (Neon PgBouncer 는 SET 을 지원하지 않는다)");
  }
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await c.connect();
  } catch (e) {
    throw new Error(describeConnError(e, url));
  }
  await c.query("SET lock_timeout = '3s'");
  await c.query("SET statement_timeout = '60s'");
  return c;
}

export function assertNotProduction(url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "") {
  if (process.env.ALLOW_DESTRUCTIVE === "1") return;
  // DB 이름(경로의 마지막 세그먼트)만 본다 — 사용자명 majubom: 에 매치되면 로컬도 프로덕션으로 오판한다
  const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
  if (process.env.NODE_ENV === "production" || /prod/i.test(dbName) || /^majubom$/.test(dbName)) {
    throw new Error("프로덕션으로 보이는 DB 에 파괴적 작업을 거부한다. 정말이면 ALLOW_DESTRUCTIVE=1");
  }
}

/** pg/net 오류를 읽을 수 있는 문장으로. ECONNREFUSED ×2(IPv4·IPv6) 는 AggregateError 라 message 가 비어 "✗ 실패:" 만 찍힌다. */
export function describeConnError(e: unknown, url: string): string {
  const host = (() => { try { return new URL(url).host; } catch { return "(URL 파싱 실패)"; } })();
  const errs: unknown[] = e instanceof AggregateError ? e.errors : [e];
  const codes = [...new Set(errs.map((x) => (x as { code?: string })?.code).filter(Boolean))] as string[];
  const msg = errs.map((x) => (x as Error)?.message).find(Boolean);
  let hint = "";
  if (codes.includes("ECONNREFUSED") && /localhost|127\.0\.0\.1/.test(host)) hint = "로컬 Postgres 가 떠 있지 않다. Neon 을 쓸 거면 .env.local 의 DATABASE_URL* 를 Neon 주소로";
  else if (codes.includes("ENOTFOUND")) hint = "호스트를 찾을 수 없다. ep-… 부분을 Neon 콘솔 Connect 에서 다시 확인";
  else if (codes.includes("28P01") || /password/i.test(msg ?? "")) hint = "비밀번호 오류. Neon 콘솔 Connect → Show password";
  else if (/ssl/i.test(msg ?? "")) hint = "Neon 은 ?sslmode=verify-full 이 필요하다";
  return `DB 연결 실패 — ${host}${codes.length ? ` [${codes.join(", ")}]` : ""}${msg ? `: ${msg}` : ""}${hint ? `\n  → ${hint}` : ""}`;
}

/**
 * 스크립트가 던진 오류를 사람이 읽을 문장으로. **연결 오류로 단정하지 않는다** —
 * `describeConnError` 를 그냥 부르면 원인이 무엇이든 "DB 연결 실패" 라는 라벨이 붙어,
 * 표가 없는 것도·입력이 틀린 것도 연결 문제로 오진단된다(리뷰 지적).
 *
 * drizzle 은 pg 오류를 `DrizzleQueryError` 로 감싸고 원인을 `cause` 에만 담는다. 그래서 사슬을
 * 벗겨 보고, **연결·DB 상태로 판정되는 것만** 그 문장을 쓴다. 나머지는 원인 사슬을 그대로 보여 준다.
 */
export function explainDbError(e: unknown): string {
  const chain: unknown[] = [];
  for (let cur: unknown = e; cur && chain.length < 5; cur = (cur as { cause?: unknown }).cause) chain.push(cur);
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
  if (!url) return "DATABASE_URL 이 없다 — .env.local 에 넣거나 명령 앞에 붙여서 실행할 것";

  const CONN = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET", "28P01", "28000"];
  const net = chain.find((x) => x instanceof AggregateError || CONN.includes((x as { code?: string }).code ?? ""));
  if (net) return describeConnError(net, url);

  const pg = chain.find((x) => /^[0-9A-Z]{5}$/.test((x as { code?: string }).code ?? "")) as { code?: string; message?: string } | undefined;
  if (pg?.code === "42P01") return `표가 없다 (42P01) — 이 DB 에 마이그레이션이 안 돌았다. \`npm run db:migrate\` 뒤 다시\n  ${pg.message ?? ""}`;
  if (pg?.code === "3D000") return `그런 이름의 데이터베이스가 없다 (3D000) — DATABASE_URL 의 마지막 경로를 확인\n  ${pg.message ?? ""}`;
  if (pg) return `Postgres 오류 ${pg.code}: ${pg.message ?? ""}`;

  // 연결·DB 문제가 아니다. 지어내지 말고 원인 사슬을 그대로 보여 준다
  return chain.map((x) => (x as Error)?.message).filter(Boolean).join("\n  ← ") || String(e);
}
