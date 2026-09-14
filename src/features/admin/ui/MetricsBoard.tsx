import type { AdminMetrics } from "@/features/admin/metrics";

/**
 * 서비스 지표 (FR-ADM-050, #69). **서버 컴포넌트다** — 고를 것도 접을 것도 없고,
 * 숫자를 보러 온 화면에 하이드레이션을 기다리게 할 이유가 없다.
 */
const STATUS_TEXT: Record<string, string> = {
  REQUESTED: "승인 대기",
  CONFIRMED: "확정",
  COMPLETED: "완료",
  CANCELED_BY_USER: "고객 취소",
  CANCELED_BY_BIZ: "매장 취소",
  NO_SHOW: "노쇼",
  REJECTED: "거절",
  EXPIRED: "만료",
};

/** 표본이 없으면 `—` 다. 0% 로 그리면 "아무 일도 없었다" 가 아니라 "괜찮다" 로 읽힌다 */
function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric-card">
      <span className="metric-card__label">{label}</span>
      <b className="metric-card__value">{value}</b>
      {sub && <span className="metric-card__sub">{sub}</span>}
    </div>
  );
}

export function MetricsBoard({ m }: { m: AdminMetrics }) {
  const peak = Math.max(1, ...m.daily.map((d) => d.count));
  const mixTotal = m.statusMix.reduce((a, b) => a + b.count, 0);
  const topPeak = Math.max(1, ...m.topBusinesses.map((t) => t.count));

  return (
    <>
      <div className="metric-cards">
        <Card label="사업장" value={`${m.businesses.total}`} sub={`승인 ${m.businesses.approved} · 대기 ${m.businesses.pending} · 정지 ${m.businesses.suspended + m.businesses.blocked}`} />
        <Card label="사용자" value={`${m.users.total}`} sub={`이번 달 신규 ${m.users.newThisMonth}`} />
        <Card label="오늘 활동" value={`${m.dau}`} sub="로그인 또는 예약" />
        <Card label="이번 달 예약" value={`${m.reservationsThisMonth}`} />
      </div>

      <section className="panel">
        <h2>일별 예약 추이 (30일)</h2>
        <div className="metric-bars" role="img" aria-label={`최근 30일 일별 예약 수, 최대 ${peak}건`}>
          {m.daily.map((d) => (
            // 0 인 날도 칸을 차지한다 — 빼면 조용한 날이 사라지고 기울기가 실제보다 가팔라 보인다
            <span key={d.date} className="metric-bar" title={`${d.date} · ${d.count}건`}>
              <i style={{ height: `${(d.count / peak) * 100}%` }} />
            </span>
          ))}
        </div>
        <p className="sub">{m.daily[0]?.date} ~ {m.daily[m.daily.length - 1]?.date} · 최대 {peak}건</p>
      </section>

      <div className="metric-two">
        <section className="panel">
          <h2>사업장별 예약 (이번 달 상위 10)</h2>
          {m.topBusinesses.length === 0 ? (
            <p className="sub">이번 달 예약이 아직 없어요.</p>
          ) : (
            <ol className="metric-rank">
              {m.topBusinesses.map((t) => (
                <li key={t.name}>
                  <span className="metric-rank__name">{t.name}</span>
                  <span className="metric-rank__bar" style={{ width: `${(t.count / topPeak) * 100}%` }} />
                  <b>{t.count}</b>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel">
          <h2>예약 상태 분포 (이번 달)</h2>
          {mixTotal === 0 ? (
            <p className="sub">이번 달 예약이 아직 없어요.</p>
          ) : (
            <ul className="metric-mix">
              {m.statusMix.map((s) => (
                <li key={s.status}>
                  <span>{STATUS_TEXT[s.status] ?? s.status}</span>
                  <b>{s.count}</b>
                  <span className="sub">{((s.count / mixTotal) * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>품질 지표 (이번 달)</h2>
        <div className="metric-cards">
          <Card label="확정률" value={pct(m.quality.confirmRate)} sub={`결론 난 신청 ${m.quality.confirmDecided}건 기준`} />
          <Card label="취소율" value={pct(m.quality.cancelRate)} />
          <Card label="노쇼율" value={pct(m.quality.noShowRate)} sub="자동 노쇼 제외" />
          <Card label="평균 승인 소요" value={m.quality.avgApproveMin === null ? "—" : `${Math.round(m.quality.avgApproveMin)}분`} />
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          확정률은 <b>수동 승인</b> 사업장에서만 뜻이 있어 승인 대기로 들어온 예약만 셉니다 — 자동 승인은 언제나 100%예요.
          노쇼율의 분모는 <b>끝난 예약</b>(완료 + 노쇼)이고, 배치가 찍은 자동 노쇼는 손님의 행동이 아니라 빼고 셉니다.
        </p>
        {/* 없는 지표를 조용히 빼면 "명세에 있었는데 어디 갔지" 가 된다. 왜 없는지 화면이 말한다 */}
        <p className="sub">
          <b>로그인 단계 전환율</b>(위젯 로그인 도달 → 예약 완료)은 아직 없습니다 — 위젯 단계 이동을 남기는 곳이 없어
          도달 수를 셀 방법이 없어요. 퍼널 적재를 만들 때 함께 붙입니다.
        </p>
      </section>
    </>
  );
}
