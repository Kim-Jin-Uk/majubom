/**
 * 배포된 DB 가 지금 코드와 같은 자리에 있는지 확인한다 (읽기 전용).
 *
 * `db:check` 는 "제약이 살아 있는가" 를 보고, 이건 "마이그레이션이 어디까지 갔는가" 를 본다 —
 * 배포 전후에 둘 다 필요하다. 특히 enum 값 추가(0004·0005)는 새 코드가 이미 쓰는 값이라
 * 빠져 있으면 감사 로그 쓰기가 런타임에 실패하는데, 제약 검사로는 잡히지 않는다.
 *
 *   npm run db:status
 *
 * 아무것도 바꾸지 않으므로 프로덕션에 그대로 돌려도 된다. 값·연결 문자열은 찍지 않는다.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ddlClient } from "./_conn";

/** 코드가 실제로 쓰는 enum 값 — 없으면 그 기능이 런타임에 죽는다 */
const REQUIRED_AUDIT_ACTIONS = ["LEAVE_APPROVE", "LEAVE_DENY", "BUSINESS_UPDATE", "MEMBER_REACTIVATE", "RESERVATION_STATUS_CHANGE", "RESERVATION_REASSIGN"];
/** 마이그레이션이 만든 것 중 코드가 곧바로 의존하는 것들 */
const REQUIRED_COLUMNS: Array<[string, string]> = [
  ["work_exceptions", "status"],
  ["reservations", "guest_label"],
  ["reservations", "replaces_reservation_id"],
  // 0008 — 예약 위젯의 로그인 왕복이 이 표 없이는 통째로 깨진다 (#83)
  ["booking_selections", "business_date"],
];
const REQUIRED_INDEXES = ["reservations_replaces_idx", "work_exceptions_business_status_idx"];

async function main() {
  const client = await ddlClient();
  const problems: string[] = [];
  try {
    const q = async <T extends Record<string, unknown>>(sql: string) => (await client.query(sql)).rows as T[];

    const files = readdirSync(join(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).sort();
    const applied = await q<{ n: string }>("SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations");
    const appliedN = Number(applied[0]?.n ?? 0);
    console.log(`마이그레이션  파일 ${files.length}건 / 적용 ${appliedN}건${appliedN === files.length ? "  ✓" : ""}`);
    if (appliedN < files.length) problems.push(`적용 안 된 마이그레이션 ${files.length - appliedN}건 — npm run db:migrate`);
    if (appliedN > files.length) problems.push(`DB 가 파일보다 앞서 있다 (${appliedN} > ${files.length}) — 브랜치를 확인할 것`);

    const actions = (await q<{ v: string }>("SELECT unnest(enum_range(NULL::audit_action))::text AS v")).map((r) => r.v);
    const missingActions = REQUIRED_AUDIT_ACTIONS.filter((a) => !actions.includes(a));
    console.log(`audit_action  ${actions.length}종${missingActions.length ? `  ✗ 없음: ${missingActions.join(", ")}` : "  ✓"}`);
    if (missingActions.length) problems.push(`audit_action 값 누락: ${missingActions.join(", ")} — 이 값을 쓰는 경로가 런타임에 실패한다`);

    for (const [table, column] of REQUIRED_COLUMNS) {
      const hit = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}'`);
      console.log(`컬럼          ${table}.${column}${hit.length ? "  ✓" : "  ✗ 없음"}`);
      if (!hit.length) problems.push(`${table}.${column} 없음`);
    }
    for (const name of REQUIRED_INDEXES) {
      const hit = await q(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='${name}'`);
      console.log(`인덱스        ${name}${hit.length ? "  ✓" : "  ✗ 없음"}`);
      if (!hit.length) problems.push(`인덱스 ${name} 없음`);
    }

    const [rows] = await q<{ businesses: string; users: string; reservations: string; pending: string }>(
      `SELECT (SELECT count(*) FROM businesses)::text AS businesses,
              (SELECT count(*) FROM users)::text AS users,
              (SELECT count(*) FROM reservations)::text AS reservations,
              (SELECT count(*) FROM reservations WHERE status='REQUESTED')::text AS pending`,
    );
    // 승인 대기가 이상하게 많으면 만료 배치(C2)가 안 도는 것이다 — 배치는 로그를 남기지 않으므로 여기가 유일한 신호다
    console.log(`행 수          사업장 ${rows.businesses} · 사용자 ${rows.users} · 예약 ${rows.reservations} (승인 대기 ${rows.pending})`);
  } finally {
    await client.end();
  }
  if (problems.length) {
    console.error(`\n✗ ${problems.length}건:`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log("\n✓ DB 가 이 브랜치의 코드와 같은 자리에 있다");
}

main().catch((e) => {
  console.error("✗ db:status 실행 실패:", (e as Error).message ?? e);
  process.exit(1);
});
