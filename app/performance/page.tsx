'use client';

// app/performance/page.tsx — Performance Dashboard (M6 Task 5)
// Requires: GET /api/bets/performance + GET /api/bets (CLV trend) + GET /api/bets/discipline

import { useState, useEffect } from 'react';

interface CLVByDecision {
  count: number;
  avgCLV: number | null;
}

interface Performance {
  totalBets: number;
  betsWithCLV: number;
  averageCLV: number | null;
  positiveCLVCount: number;
  positiveCLVPct: number | null;
  clvByDecision: {
    bet: CLVByDecision;
    lean: CLVByDecision;
    watchlist: CLVByDecision;
  };
  resolvedBets: number;
  wins: number;
  losses: number;
  winPct: number | null;
  roi: number | null;
  totalStaked: number;
  totalPayout: number;
}

interface BetResult {
  clv: number | null;
  result: string | null;
}

interface Bet {
  id: string;
  modelDecisionAtBet: string | null;
  stakeAmount: number;
  createdAt: string;
  result: BetResult | null;
}

interface Discipline {
  betLeanGames: number;
  betsPlacedOnBetLean: number;
  disciplineScore: number | null;
  note: string;
}

const s = {
  metricCard: {
    background: '#161616',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    padding: '0.9rem 1rem',
  } as React.CSSProperties,
  metricLabel: {
    fontSize: '0.6rem',
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: '0.3rem',
  },
  metricValue: {
    fontSize: '1.4rem',
    fontWeight: 'bold',
    lineHeight: 1,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '0.7rem',
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    marginBottom: '0.6rem',
    marginTop: '1.25rem',
  },
  tierRow: {
    display: 'grid',
    gridTemplateColumns: '100px 80px 1fr',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.35rem',
    fontSize: '0.78rem',
  } as React.CSSProperties,
};

function clvColor(v: number | null): string {
  if (v === null) return '#555';
  if (v > 0) return '#4caf50';
  if (v < 0) return '#f44336';
  return '#888';
}

function fmtPct(n: number | null, places = 1, multiply100 = false): string {
  if (n === null || n === undefined) return '—';
  const val = multiply100 ? n * 100 : n;
  return `${val > 0 ? '+' : ''}${val.toFixed(places)}%`;
}

function MetricCard({
  label, value, color, sub,
}: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div style={{ ...s.metricValue, color: color || '#ccc' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#555', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  );
}

// CLV Bar Chart — last 20 bets, HTML/CSS bars, no library
function CLVTrendChart({ bets }: { bets: Bet[] }) {
  // Take last 20 bets that have CLV
  const withCLV = [...bets]
    .filter(b => b.result?.clv !== null && b.result?.clv !== undefined)
    .slice(-20);

  if (withCLV.length === 0) {
    return (
      <div style={{ color: '#555', fontSize: '0.8rem', padding: '1rem', border: '1px solid #222', borderRadius: '3px', textAlign: 'center' }}>
        No CLV data yet — bets appear here after closing lines are captured.
      </div>
    );
  }

  const clvValues = withCLV.map(b => b.result!.clv! * 100); // convert to percentage points
  const maxAbs = Math.max(...clvValues.map(Math.abs), 0.1);
  const BAR_HEIGHT = 80; // px total chart height
  const BAR_WIDTH = Math.max(12, Math.floor(540 / withCLV.length) - 3);

  return (
    <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '0.75rem 1rem' }}>
      <div style={{ fontSize: '0.65rem', color: '#555', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        CLV — Last {withCLV.length} Bets (% points)
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: `${BAR_HEIGHT * 2 + 2}px`, position: 'relative' }}>
        {/* Zero line */}
        <div style={{
          position: 'absolute',
          top: `${BAR_HEIGHT}px`,
          left: 0,
          right: 0,
          borderTop: '1px solid #333',
          zIndex: 1,
        }} />
        {clvValues.map((val, i) => {
          const barLen = Math.abs(val) / maxAbs * BAR_HEIGHT;
          const isPos = val >= 0;
          const color = isPos ? '#4caf50' : '#f44336';
          const bet = withCLV[i];
          const dateStr = new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
          return (
            <div
              key={bet.id}
              title={`${bet.modelDecisionAtBet?.toUpperCase() || '?'} | ${val > 0 ? '+' : ''}${val.toFixed(2)}% CLV | ${dateStr}`}
              style={{
                width: `${BAR_WIDTH}px`,
                position: 'relative',
                height: `${BAR_HEIGHT * 2}px`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                cursor: 'default',
              }}
            >
              {isPos ? (
                <>
                  <div style={{ flex: 1 }} />
                  <div style={{ height: `${barLen}px`, background: color, borderRadius: '1px 1px 0 0', opacity: 0.85 }} />
                  <div style={{ height: `${BAR_HEIGHT}px` }} />
                </>
              ) : (
                <>
                  <div style={{ height: `${BAR_HEIGHT}px` }} />
                  <div style={{ height: `${barLen}px`, background: color, borderRadius: '0 0 1px 1px', opacity: 0.85 }} />
                  <div style={{ flex: 1 }} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: '0.65rem', color: '#444', marginTop: '0.3rem' }}>
        Hover a bar for details. Green = positive CLV (beat closing line). Red = negative.
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const [perf, setPerf] = useState<Performance | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [perfRes, betsRes, discRes] = await Promise.all([
          fetch('/api/bets/performance'),
          fetch('/api/bets'),
          fetch('/api/bets/discipline'),
        ]);
        if (!perfRes.ok) throw new Error(`Performance API error: ${perfRes.status}`);
        if (!betsRes.ok) throw new Error(`Bets API error: ${betsRes.status}`);
        // discipline is non-critical — don't throw if it fails
        const [perfData, betsData] = await Promise.all([perfRes.json(), betsRes.json()]);
        setPerf(perfData);
        setBets(Array.isArray(betsData) ? betsData : []);
        if (discRes.ok) {
          setDiscipline(await discRes.json());
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load performance data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div style={{ color: '#555', fontSize: '0.85rem' }}>Loading performance data…</div>;
  if (error) return <div style={{ color: '#f44', fontSize: '0.85rem' }}>{error}</div>;
  if (!perf) return null;

  // ── Discipline Score ──────────────────────────────────────────────────────
  // From /api/bets/discipline: % of Bet/Lean-evaluated games where a bet was placed.
  const disciplineScore = discipline?.disciplineScore !== null && discipline?.disciplineScore !== undefined
    ? `${discipline.disciplineScore.toFixed(1)}%`
    : 'N/A';
  const disciplineNote = discipline?.note || 'Awaiting model evaluations';

  const avgCLVDisplay = perf.averageCLV !== null
    ? `${perf.averageCLV > 0 ? '+' : ''}${(perf.averageCLV * 100).toFixed(2)}%`
    : '—';

  return (
    <div>
      <h2 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Performance Dashboard
      </h2>

      {perf.totalBets === 0 ? (
        <div style={{ color: '#555', fontSize: '0.85rem', padding: '2rem', textAlign: 'center', border: '1px solid #222', borderRadius: '4px' }}>
          No bets logged yet. Performance data appears here after you log bets.
        </div>
      ) : (
        <>
          {/* Top metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
            <MetricCard
              label="Total Bets"
              value={String(perf.totalBets)}
              sub={`${perf.betsWithCLV} with CLV`}
            />
            <MetricCard
              label="Average CLV"
              value={avgCLVDisplay}
              color={clvColor(perf.averageCLV)}
              sub={`${perf.positiveCLVCount} positive (${perf.positiveCLVPct?.toFixed(1) ?? '—'}%)`}
            />
            <MetricCard
              label="Win %"
              value={perf.winPct !== null ? `${perf.winPct.toFixed(1)}%` : '—'}
              sub={`${perf.wins}W / ${perf.losses}L (${perf.resolvedBets} resolved)`}
            />
            <MetricCard
              label="ROI"
              value={perf.roi !== null ? `${perf.roi > 0 ? '+' : ''}${perf.roi.toFixed(1)}%` : '—'}
              color={clvColor(perf.roi)}
              sub={`Staked ${perf.totalStaked.toFixed(2)} → ${perf.totalPayout.toFixed(2)}`}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            {/* CLV by Decision Tier */}
            <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '0.75rem 1rem' }}>
              <div style={s.sectionTitle} >CLV by Decision Tier</div>
              {(['bet', 'lean', 'watchlist'] as const).map(tier => {
                const d = perf.clvByDecision[tier];
                const clv = d.avgCLV;
                const barWidth = clv !== null ? Math.min(Math.abs(clv * 100) * 5, 100) : 0;
                return (
                  <div key={tier} style={s.tierRow}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      color: tier === 'bet' ? '#4caf50' : tier === 'lean' ? '#ffc107' : '#666',
                    }}>
                      {tier} ({d.count})
                    </span>
                    <span style={{ color: clvColor(clv), fontSize: '0.78rem' }}>
                      {clv !== null ? fmtPct(clv * 100, 2) : '—'}
                    </span>
                    <div style={{ background: '#111', borderRadius: '2px', height: '6px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${barWidth}%`,
                        height: '100%',
                        background: clv !== null && clv > 0 ? '#4caf50' : '#f44336',
                        opacity: 0.7,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Discipline Score */}
            <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '0.75rem 1rem' }}>
              <div style={s.sectionTitle}>Discipline Score</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ccc', marginBottom: '0.3rem' }}>
                {disciplineScore}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#555' }}>{disciplineNote}</div>
              <div style={{ fontSize: '0.68rem', color: '#444', marginTop: '0.5rem', lineHeight: 1.4 }}>
                % of logged bets that followed a Bet or Lean signal.<br />
                High = disciplined execution of model recommendations.
              </div>
            </div>
          </div>

          {/* CLV Trend Chart */}
          <CLVTrendChart bets={bets} />
        </>
      )}
    </div>
  );
}
