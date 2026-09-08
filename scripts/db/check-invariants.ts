/**
 * 스키마 불변 제약 검사 (08 §6.1). 마이그레이션 적용 뒤 아래가 전부 참이어야 머지 가능하다.
 * FR-BOOK-020 의 이중 예약 방어선이 **조용히 사라지는 모든 경로**(nullable 구멍 · 확장 DROP · 금지 키워드 · revert 드리프트)를
 * 이 그물 하나가 잡는다. 하나라도 실패하면 exit 1.
 *
 *   npm run db:check
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ddlClient } from "./_conn";

type Check = { name: string; run: () => Promise<string | null> }; // null = 통과, string = 실패 사유
type Result = { name: string; ok: boolean; detail: string };

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const BANNED_KEYWORD = /\bCASCADE\b/i;

function buildChecks(q: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>): Check[] {
  return [
    {
      name: "btree_gist 확장 설치됨",
      run: async () => {
        const rows = await q<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'");
        return rows.length === 1 ? null : "pg_extension 에 btree_gist 없음 — EXCLUDE 제약이 함께 사라졌을 가능성";
      },
    },
    {
      name: "reservations.no_overlap EXCLUDE 제약 존재",
      run: async () => {
        const rows = await q<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'no_overlap' AND contype = 'x' AND conrelid = 'public.reservations'::regclass`,
        );
        if (rows.length !== 1) return "contype='x' 인 no_overlap 제약이 reservations 에 없음";
        const def = rows[0].def;
        if (!/resource_id WITH =/.test(def) || !/occupy_range WITH &&/.test(def)) return `제약 정의가 다름: ${def}`;
        if (!/WHERE \(\(exclusive AND/.test(def)) return `술어에 exclusive 가 없음: ${def}`;
        return null;
      },
    },
    {
      name: "work_schedules.work_schedule_no_overlap EXCLUDE 제약 존재",
      run: async () => {
        const rows = await q<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'work_schedule_no_overlap' AND contype = 'x' AND conrelid = 'public.work_schedules'::regclass`,
        );
        if (rows.length !== 1) return "contype='x' 인 work_schedule_no_overlap 제약이 work_schedules 에 없음";
        return /daterange\(effective_from, effective_to/.test(rows[0].def) ? null : `제약 정의가 다름: ${rows[0].def}`;
      },
    },
    {
      name: "reservations.exclusive 가 NOT NULL boolean DEFAULT false",
      run: async () => {
        const rows = await q<{ is_nullable: string; data_type: string; column_default: string | null }>(
          `SELECT is_nullable, data_type, column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'exclusive'`,
        );
        if (rows.length !== 1) return "reservations.exclusive 컬럼이 없음";
        const c = rows[0];
        if (c.is_nullable !== "NO") return "exclusive 가 nullable — 제약 술어 사정권에 구멍 (08 §5.3 ④)";
        if (c.data_type !== "boolean") return `타입이 boolean 이 아님: ${c.data_type}`;
        if (c.column_default !== "false") return `DEFAULT 가 false 가 아님: ${c.column_default ?? "(없음)"}`;
        return null;
      },
    },
    {
      name: "exclusive IS NULL 인 예약 0건",
      run: async () => {
        const rows = await q<{ n: string }>("SELECT count(*)::text AS n FROM reservations WHERE exclusive IS NULL");
        return rows[0].n === "0" ? null : `${rows[0].n} 건이 제약 사정권 밖에 있음`;
      },
    },
    {
      name: "reservations.occupy_range 가 NOT NULL tstzrange",
      run: async () => {
        const rows = await q<{ is_nullable: string; udt_name: string }>(
          `SELECT is_nullable, udt_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'occupy_range'`,
        );
        if (rows.length !== 1) return "occupy_range 컬럼이 없음";
        if (rows[0].udt_name !== "tstzrange") return `타입이 tstzrange 가 아님: ${rows[0].udt_name}`;
        return rows[0].is_nullable === "NO" ? null : "occupy_range 가 nullable";
      },
    },
    {
      name: "occupy_range 파생 CHECK 존재 (버퍼 스냅샷 규약)",
      run: async () => {
        const rows = await q<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_constraint
            WHERE conrelid = 'public.reservations'::regclass AND contype = 'c' AND conname = 'reservations_occupy_derivation'`,
        );
        return rows[0].n === "1" ? null : "reservations_occupy_derivation CHECK 가 없음";
      },
    },
    {
      name: "drizzle/*.sql 에 CASCADE 없음",
      run: async () => {
        const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
        if (files.length === 0) return "drizzle/ 에 마이그레이션 SQL 이 없음";
        const hits: string[] = [];
        for (const f of files) {
          const lines = readFileSync(join(MIGRATIONS_DIR, f), "utf8").split("\n");
          lines.forEach((line, i) => {
            if (BANNED_KEYWORD.test(line)) hits.push(`${f}:${i + 1}`);
          });
        }
        return hits.length === 0 ? null : `금지 키워드 발견: ${hits.join(", ")}`;
      },
    },
    {
      name: "chat_rooms / chat_messages 테이블 없음 (Firestore 경계, 06 §5)",
      run: async () => {
        const rows = await q<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('chat_rooms', 'chat_messages')`,
        );
        return rows.length === 0 ? null : `Postgres 에 채팅 테이블이 있음: ${rows.map((r) => r.table_name).join(", ")}`;
      },
    },
  ];
}

function printTable(results: Result[]) {
  const w = Math.max(...results.map((r) => r.name.length), 4);
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(`${pad("검사", w)}  결과  상세`);
  console.log(`${"-".repeat(w)}  ----  ${"-".repeat(40)}`);
  for (const r of results) console.log(`${pad(r.name, w)}  ${r.ok ? "PASS" : "FAIL"}  ${r.detail}`);
}

async function main() {
  const client = await ddlClient();
  const results: Result[] = [];
  try {
    const q = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows as T[];
    for (const check of buildChecks(q)) {
      try {
        const failure = await check.run();
        results.push({ name: check.name, ok: failure === null, detail: failure ?? "" });
      } catch (e) {
        results.push({ name: check.name, ok: false, detail: `쿼리 오류: ${(e as Error).message}` });
      }
    }
  } finally {
    await client.end();
  }
  printTable(results);
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.error(`\n✗ 스키마 불변 제약 ${failed}/${results.length} 실패`);
    process.exit(1);
  }
  console.log(`\n✓ 스키마 불변 제약 ${results.length}/${results.length} 통과`);
}

main().catch((e) => {
  console.error("✗ db:check 실행 실패:", (e as Error).message ?? e);
  process.exit(1);
});
