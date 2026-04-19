'use client';

// app/bets/page.tsx — Bet Tracker (M6 Task 4)

import { useState, useEffect } from 'react';

interface BetResult {
  closingOdds: number | null;
  closingImpliedProbability: number | null;
  clv: number | null;
  result: string | null;
  payoutAmount: number | null;
  clvCapturedAt: string | null;
}

interface Bet {
  id: string;
  gameId: string;
  teamBetOn: string;
  oddsAtBet: number;
  impliedProbabilityAtBet: number;
  modelDecisionAtBet: string | null;
  edgeAtBet: number | null;
  stakeAmount: number;
  notes: string | null;
  createdAt: string;
  result: BetResult | null;
}

interface Performance {
  totalBets: number;
  betsWithCLV: number;
  averageCLV: number | null;
  positiveCLVCount: number;
  positiveCLVPct: number | null;
  resolvedBets: number;
  wins: number;
  losses: number;
  winPct: number | null;
  roi: number | null;
  totalStaked: number;
  totalPayout: number;
}

const s = {
  th: {
    fontSize: '0.65rem',
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    padding: '0.5rem 0.6rem',
    textAlign: 'left' as const,
    borderBottom: '1px solid #222',
    fontWeight: 'normal',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    fontSize: '0.78rem',
    color: '#bbb',
    padding: '0.45rem 0.6rem',
    borderBottom: '1px solid #1a1a1a',
    verticalAlign: 'middle' as const,
  },
  summaryCard: {
    background: '#161616',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
    display: 'flex',
    gap: '2rem',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
};

function clvColor(clv: number | null): string {
  if (clv === null) return '#555';
  if (clv > 0) return '#4caf50';
  if (clv < 0) return '#f44336';
  return '#888';
}

function fmtOdds(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtPct(n: number | null, decimals = 1): string {
  if (n === null || n === undefined) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.15rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', color: color || '#ccc', fontWeight: 'bold' }}>
        {value}
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span style={{ color: '#444' }}>—</span>;
  const colors: Record<string, string> = {
    bet: '#4caf50', lean: '#ffc107', watchlist: '#888', pass: '#444',
  };
  return (
    <span style={{ color: colors[decision.toLowerCase()] || '#888', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 'bold' }}>
      {decision.toUpperCase()}
    </span>
  );
}

export default function BetsPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [betsRes, perfRes] = await Promise.all([
          fetch('/api/bets'),
          fetch('/api/bets/performance'),
        ]);
        if (!betsRes.ok) throw new Error(`Bets API error: ${betsRes.status}`);
        if (!perfRes.ok) throw new Error(`Performance API error: ${perfRes.status}`);
        const [betsData, perfData] = await Promise.all([betsRes.json(), perfRes.json()]);
        setBets(Array.isArray(betsData) ? betsData : []);
        setPerf(perfData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load bets');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div style={{ color: '#555', fontSize: '0.85rem' }}>Loading bets…</div>;
  if (error) return <div style={{ color: '#f44', fontSize: '0.85rem' }}>{error}</div>;

  const avgCLVColor = perf?.averageCLV !== null && perf?.averageCLV !== undefined
    ? clvColor(perf.averageCLV)
    : '#555';

  return (
    <div>
      <h2 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Bet Tracker
      </h2>

      {/* Summary row */}
      <div style={s.summaryCard}>
        <StatBox label="Total Bets" value={String(perf?.totalBets ?? 0)} />
        <StatBox
          label="Avg CLV"
          value={perf?.averageCLV !== null && perf?.averageCLV !== undefined
            ? fmtPct(perf.averageCLV * 100, 2)
            : '—'}
          color={avgCLVColor}
        />
        <StatBox
          label="% Positive CLV"
          value={perf?.positiveCLVPct !== null && perf?.positiveCLVPct !== undefined
            ? `${perf.positiveCLVPct.toFixed(1)}%`
            : '—'}
        />
        <StatBox
          label="Win %"
          value={perf?.winPct !== null && perf?.winPct !== undefined
            ? `${perf.winPct.toFixed(1)}%`
            : '—'}
        />
        <StatBox
          label="ROI"
          value={perf?.roi !== null && perf?.roi !== undefined
            ? `${perf.roi > 0 ? '+' : ''}${perf.roi.toFixed(1)}%`
            : '—'}
          color={perf?.roi !== null && perf?.roi !== undefined ? clvColor(perf.roi) : '#555'}
        />
        <StatBox label="Resolved" value={`${perf?.resolvedBets ?? 0} (${perf?.wins ?? 0}W ${perf?.losses ?? 0}L)`} />
      </div>

      {bets.length === 0 ? (
        <div style={{ color: '#555', fontSize: '0.85rem', padding: '2rem', textAlign: 'center', border: '1px solid #222', borderRadius: '4px' }}>
          No bets logged yet. Use the Games view to log a bet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#161616', border: '1px solid #2a2a2a', borderRadius: '4px' }}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>Game</th>
                <th style={s.th}>Team</th>
                <th style={s.th}>Odds</th>
                <th style={s.th}>Stake</th>
                <th style={s.th}>Decision</th>
                <th style={s.th}>Edge</th>
                <th style={s.th}>CLV</th>
                <th style={s.th}>Result</th>
                <th style={s.th}>Payout</th>
              </tr>
            </thead>
            <tbody>
              {bets.map(bet => {
                const clv = bet.result?.clv ?? null;
                const result = bet.result?.result ?? null;
                const payout = bet.result?.payoutAmount ?? null;

                return (
                  <tr key={bet.id}>
                    <td style={s.td}>
                      {new Date(bet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td style={{ ...s.td, color: '#888', fontSize: '0.72rem' }}>
                      {bet.gameId.slice(0, 8)}…
                    </td>
                    <td style={{ ...s.td, fontWeight: 'bold', color: '#ddd' }}>
                      {bet.teamBetOn}
                    </td>
                    <td style={s.td}>{fmtOdds(bet.oddsAtBet)}</td>
                    <td style={s.td}>{bet.stakeAmount.toFixed(2)}</td>
                    <td style={s.td}>
                      <DecisionBadge decision={bet.modelDecisionAtBet} />
                    </td>
                    <td style={{ ...s.td, color: bet.edgeAtBet !== null ? (bet.edgeAtBet > 0 ? '#4caf50' : '#f44336') : '#555' }}>
                      {bet.edgeAtBet !== null ? fmtPct(bet.edgeAtBet, 2) : '—'}
                    </td>
                    <td style={{ ...s.td, color: clvColor(clv), fontWeight: clv !== null ? 'bold' : 'normal' }}>
                      {clv !== null
                        ? `${clv > 0 ? '+' : ''}${(clv * 100).toFixed(2)}%`
                        : <span style={{ color: '#444' }}>Pending</span>}
                    </td>
                    <td style={{ ...s.td, color: result === 'win' ? '#4caf50' : result === 'loss' ? '#f44336' : '#555' }}>
                      {result ? result.toUpperCase() : <span style={{ color: '#444' }}>Pending</span>}
                    </td>
                    <td style={s.td}>
                      {payout !== null ? payout.toFixed(2) : <span style={{ color: '#444' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
