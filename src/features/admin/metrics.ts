import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { businesses, reservations, users } from "@/db/schema";
import { localToInstant } from "@/features/booking/time";
import { todayIn } from "@/lib/dates";

/**
 * 서비스 지표 대시보드 (FR-ADM-050, #69). **집계 테이블을 읽지 않는다** — `usage_counters` 를 채우는
 * C4 배치가 아직 없고(#67), 있더라도 그건 사업장 × 일 단위 사용량이라 여기서 필요한 전역 품질 지표와 다르다.
 * 지금 규모에서는 원장을 직접 세는 편이 정확하고, 숫자가 배치 지연만큼 늦지도 않는다.
 *
 * **모든 기간 경계는 KST 다.** 운영자가 "오늘"·"이번 달" 이라고 할 때 UTC 하루가 아니다 —
 * UTC 로 자르면 매일 오전 9시 이전이 전날로 잡힌다 (감사 로그에서 같은 실수를 했다).
 */
export const METRICS_TZ = "Asia/Seoul";
export const TREND_DAYS = 30;

export type AdminMetrics = {
  businesses: { total: number; pending: number; approved: number; suspended: number; blocked: number };
  users: { total: number; newThisMonth: number };
  /** 오늘(KST) 로그인 세션을 썼거나 예약을 만든 사람 수 */
  dau: number;
  reservationsThisMonth: number;
  /** 최근 30일, 빈 날도 0 으로 채워 넣는다 */
  daily: Array<{ date: string; count: number }>;
  topBusinesses: Array<{ id: string; name: string; count: number }>;
  statusMix: Array<{ status: string; count: number }>;
  quality: {
    /** 승인·거절·만료로 결론이 난 신청 중 승인된 비율 */
    confirmRate: number | null;
    confirmDecided: number;
    cancelRate: number | null;
    /** 자동 노쇼(AUTO)는 분자·분모 모두에서 뺀다 — 배치가 찍은 것은 손님의 행동이 아니다 */
    noShowRate: number | null;
    /** REQUESTED → CONFIRMED 까지 걸린 시간의 평균(분) */
    avgApproveMin: number | null;
  };
};

/** 0/0 은 0% 가 아니라 **모름**이다. 표본이 없는데 0% 를 띄우면 "아무도 취소하지 않았다" 로 읽힌다 */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** 그날(KST)의 시작 순간. 변환은 슬롯 계산과 같은 변환기를 쓴다 */
export function kstDayStart(date: string): Date {
  return new Date(localToInstant(date, 0, METRICS_TZ));
}

/**
 * `date` 에서 하루씩 뒤로 `days` 개, 오래된 순. **달력 날짜 계산이지 시각 계산이 아니다** —
 * 여기서 `kstDayStart` 를 쓰면 그 순간의 UTC 날짜(전날 15:00)를 문자열로 잘라 하루가 밀린다.
 * 날짜만 다루는 자리에서는 UTC 자정을 커서로 쓴다.
 */
export function dayKeys(date: string, days: number): string[] {
  const end = new Date(`${date}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * 비어 있는 날을 0 으로 채운다. 없는 날을 그냥 빼면 추이 그래프가 **날짜를 건너뛰며** 그려져
 * 조용한 날이 사라지고 기울기가 실제보다 가팔라 보인다.
 */
export function fillDaily(rows: Array<{ date: string; count: number }>, keys: string[]): Array<{ date: string; count: number }> {
  const by = new Map(rows.map((r) => [r.date, r.count]));
  return keys.map((date) => ({ date, count: by.get(date) ?? 0 }));
}

export async function loadAdminMetrics(now = new Date()): Promise<AdminMetrics> {
  const today = todayIn(METRICS_TZ, now);
  const todayStart = kstDayStart(today);
  const monthStart = kstDayStart(`${today.slice(0, 7)}-01`);
  const keys = dayKeys(today, TREND_DAYS);
  const trendStart = kstDayStart(keys[0]);

  const [bizRows, userTotal, newUsers, dau, monthCount, daily, top, mix, decided, approveMin, endedMix] = await Promise.all([
    db.select({ status: businesses.status, n: count() }).from(businesses).groupBy(businesses.status),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(gte(users.createdAt, monthStart)),
    // 로그인만 세면 예약만 하고 나간 손님이 빠지고, 예약만 세면 둘러본 사람이 빠진다. 합집합이 명세의 정의다.
    // 워크인은 사업장 내부 계정이 만든 예약이라 뺀다 — 사람 수를 세는 자리에 가게를 넣으면 안 된다
    db.execute(sql`
      select count(*)::int as n from (
        select user_id from sessions where last_used_at >= ${todayStart}
        union
        select customer_id from reservations where created_at >= ${todayStart} and created_via <> 'WALK_IN'
      ) t`),
    db.select({ n: count() }).from(reservations).where(gte(reservations.createdAt, monthStart)),
    db.execute(sql`
      select to_char(${reservations.createdAt} at time zone ${METRICS_TZ}, 'YYYY-MM-DD') as date, count(*)::int as count
      from ${reservations} where ${reservations.createdAt} >= ${trendStart}
      group by 1 order by 1`),
    // **id 로 묶는다.** 상호는 unique 가 아니다 — 이름으로 묶으면 동명 사업장 둘의 예약이 한 줄로 합쳐져
    // 있지도 않은 1위가 만들어진다 (리뷰 지적)
    db
      .select({ id: businesses.id, name: businesses.name, n: count() })
      .from(reservations)
      .innerJoin(businesses, eq(businesses.id, reservations.businessId))
      .where(gte(reservations.createdAt, monthStart))
      .groupBy(businesses.id, businesses.name)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    db.select({ status: reservations.status, n: count() }).from(reservations).where(gte(reservations.createdAt, monthStart)).groupBy(reservations.status),
    /**
     * 확정률·승인 소요시간의 정본은 **감사 로그**다. 예약 행의 현재 상태만 보면 "승인된 뒤 손님이 취소한 건" 이
     * 거절과 같은 칸에 들어간다. `from='REQUESTED'` 라는 조건이 수동 승인 사업장으로 스스로 좁혀 준다 —
     * 자동 승인이면 애초에 REQUESTED 로 생기지 않는다.
     */
    db.execute(sql`
      select diff->'status'->>'to' as to, count(*)::int as n
      from audit_logs
      where action = 'RESERVATION_STATUS_CHANGE' and created_at >= ${monthStart}
        and diff->'status'->>'from' = 'REQUESTED' and diff->'status'->>'to' in ('CONFIRMED','REJECTED','EXPIRED')
      group by 1`),
    db.execute(sql`
      select avg(extract(epoch from (a.created_at - r.created_at)) / 60)::float as m
      -- target_id 는 text 다(신고 대상이 Firestore 문서일 수 있어서). uuid 로 캐스팅하면 그런 행에서 터지므로
      -- 예약 쪽을 text 로 맞춘다 — 어차피 action 과 기간으로 먼저 좁혀진 소수의 행이다
      from audit_logs a join reservations r on r.id::text = a.target_id
      where a.action = 'RESERVATION_STATUS_CHANGE' and a.created_at >= ${monthStart}
        and a.diff->'status'->>'from' = 'REQUESTED' and a.diff->'status'->>'to' = 'CONFIRMED'`),
    // 노쇼율의 분모는 "끝난 예약" 이다. 아직 오지 않은 예약을 분모에 넣으면 월초마다 노쇼율이 치솟는다
    db
      .select({ status: reservations.status, source: reservations.noShowSource, n: count() })
      .from(reservations)
      .where(and(gte(reservations.createdAt, monthStart), sql`${reservations.status} in ('COMPLETED','NO_SHOW')`))
      .groupBy(reservations.status, reservations.noShowSource),
  ]);

  const bizOf = (s: string) => bizRows.find((r) => r.status === s)?.n ?? 0;
  const mixOf = (s: string) => mix.find((r) => r.status === s)?.n ?? 0;
  const rows = <T,>(r: unknown): T[] => (r as { rows: T[] }).rows;

  const decidedRows = rows<{ to: string; n: number }>(decided);
  const decidedTotal = decidedRows.reduce((a, b) => a + b.n, 0);
  const approved = decidedRows.find((r) => r.to === "CONFIRMED")?.n ?? 0;

  const monthTotal = monthCount[0]?.n ?? 0;
  const manualNoShow = endedMix.find((r) => r.status === "NO_SHOW" && r.source !== "AUTO")?.n ?? 0;
  const completed = endedMix.find((r) => r.status === "COMPLETED")?.n ?? 0;

  return {
    businesses: {
      total: bizRows.reduce((a, b) => a + b.n, 0),
      pending: bizOf("PENDING"),
      approved: bizOf("APPROVED"),
      suspended: bizOf("SUSPENDED"),
      blocked: bizOf("BLOCKED"),
    },
    users: { total: userTotal[0]?.n ?? 0, newThisMonth: newUsers[0]?.n ?? 0 },
    dau: rows<{ n: number }>(dau)[0]?.n ?? 0,
    reservationsThisMonth: monthTotal,
    daily: fillDaily(rows<{ date: string; count: number }>(daily), keys),
    topBusinesses: top.map((t) => ({ id: t.id, name: t.name, count: t.n })),
    statusMix: mix.map((m) => ({ status: m.status, count: m.n })).sort((a, b) => b.count - a.count),
    quality: {
      confirmRate: rate(approved, decidedTotal),
      confirmDecided: decidedTotal,
      cancelRate: rate(mixOf("CANCELED_BY_USER") + mixOf("CANCELED_BY_BIZ"), monthTotal),
      noShowRate: rate(manualNoShow, completed + manualNoShow),
      avgApproveMin: rows<{ m: number | null }>(approveMin)[0]?.m ?? null,
    },
  };
}
