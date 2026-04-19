'use client';

// DashboardPage.tsx — Daily Game View + Manual Inputs + Bet Entry (M6 Tasks 1, 2, 3)

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FactorScores {
  pitcherAdvantage: number | null;
  teamForm: number | null;
  lineMovement: number | null;
  publicSplits: number | null;
  injuryImpact: number | null;
  weather: number | null;
  restSchedule: number | null;
}

interface ModelScore {
  evaluatedTeam: string;
  marketProbability: number | null;
  modelProbability: number | null;
  edgePercentage: number | null;
  decision: string;
  pitcherGatePassed: boolean;
  factors: FactorScores;
  evaluatedAt: string;
}

interface BetSummary {
  id: string;
  teamBetOn: string;
  oddsAtBet: number;
  stakeAmount: number;
  modelDecisionAtBet: string | null;
  createdAt: string;
}

interface Odds {
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeImpliedProb: number | null;
  awayImpliedProb: number | null;
  snapshotType: string;
  capturedAt: string;
}

interface Game {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homePitcher: string | null;
  awayPitcher: string | null;
  venue: string | null;
  status: string;
  sortEdge: number;
  odds: Odds | null;
  homeModel: ModelScore | null;
  awayModel: ModelScore | null;
  bets: BetSummary[];
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  card: {
    background: '#161616',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    marginBottom: '1rem',
    overflow: 'hidden',
  } as React.CSSProperties,
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #222',
    background: '#1a1a1a',
  } as React.CSSProperties,
  teamNames: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  meta: {
    fontSize: '0.75rem',
    color: '#666',
  } as React.CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0',
  } as React.CSSProperties,
  teamCol: {
    padding: '0.75rem 1rem',
    borderRight: '1px solid #222',
  } as React.CSSProperties,
  teamColRight: {
    padding: '0.75rem 1rem',
  } as React.CSSProperties,
  label: {
    fontSize: '0.65rem',
    color: '#555',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: '0.1rem',
  },
  value: {
    fontSize: '0.85rem',
    color: '#ccc',
  } as React.CSSProperties,
  btn: {
    background: '#222',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: '3px',
    padding: '0.3rem 0.8rem',
    fontSize: '0.75rem',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  btnPrimary: {
    background: '#1a3a1a',
    color: '#4caf50',
    border: '1px solid #2d5a2d',
    borderRadius: '3px',
    padding: '0.3rem 0.8rem',
    fontSize: '0.75rem',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  factorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '0.25rem',
    marginTop: '0.5rem',
  } as React.CSSProperties,
  factorCell: {
    textAlign: 'center' as const,
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: '2px',
    padding: '0.2rem',
  },
  panel: {
    padding: '0.75rem 1rem',
    background: '#111',
    borderTop: '1px solid #1e1e1e',
  } as React.CSSProperties,
  input: {
    background: '#0d0d0d',
    border: '1px solid #333',
    color: '#ccc',
    padding: '0.3rem 0.5rem',
    fontSize: '0.8rem',
    borderRadius: '2px',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  select: {
    background: '#0d0d0d',
    border: '1px solid #333',
    color: '#ccc',
    padding: '0.3rem 0.5rem',
    fontSize: '0.8rem',
    borderRadius: '2px',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  formRow: {
    display: 'grid',
    gap: '0.5rem',
    marginBottom: '0.5rem',
  } as React.CSSProperties,
  betLogged: {
    display: 'inline-block',
    background: '#1a3a1a',
    color: '#4caf50',
    fontSize: '0.7rem',
    padding: '0.2rem 0.5rem',
    borderRadius: '2px',
    marginLeft: '0.5rem',
  } as React.CSSProperties,
  error: {
    color: '#f44',
    fontSize: '0.75rem',
    marginTop: '0.25rem',
  } as React.CSSProperties,
  success: {
    color: '#4caf50',
    fontSize: '0.75rem',
    marginTop: '0.25rem',
  } as React.CSSProperties,
};

// ─── Decision Badge ───────────────────────────────────────────────────────────

function DecisionBadge({ decision }: { decision: string }) {
  const config: Record<string, { bg: string; color: string; border: string }> = {
    bet:       { bg: '#1a3a1a', color: '#4caf50', border: '#2d5a2d' },
    lean:      { bg: '#3a3a00', color: '#ffc107', border: '#5a5000' },
    watchlist: { bg: '#1a1a1a', color: '#888',    border: '#333' },
    pass:      { bg: '#0d0d0d', color: '#444',    border: '#222' },
  };
  const c = config[decision?.toLowerCase()] || config.pass;
  return (
    <span style={{
      display: 'inline-block',
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      borderRadius: '3px',
      padding: '0.15rem 0.5rem',
      fontSize: '0.7rem',
      fontWeight: 'bold',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {decision?.toUpperCase() || 'N/A'}
    </span>
  );
}

// ─── Factor Score Display ─────────────────────────────────────────────────────

const FACTOR_LABELS = ['PIT', 'FORM', 'LINE', 'PUB', 'INJ', 'WX', 'REST'];
const FACTOR_KEYS: (keyof FactorScores)[] = [
  'pitcherAdvantage', 'teamForm', 'lineMovement',
  'publicSplits', 'injuryImpact', 'weather', 'restSchedule',
];

function FactorScores({ factors }: { factors: FactorScores }) {
  return (
    <div style={s.factorGrid}>
      {FACTOR_KEYS.map((key, i) => {
        const val = factors[key];
        const display = val !== null && val !== undefined ? val.toFixed(1) : '—';
        const color = val === null ? '#444' : val > 0 ? '#4caf50' : val < 0 ? '#f44336' : '#888';
        return (
          <div key={key} style={s.factorCell}>
            <div style={{ fontSize: '0.55rem', color: '#444', marginBottom: '0.1rem' }}>
              {FACTOR_LABELS[i]}
            </div>
            <div style={{ fontSize: '0.75rem', color, fontWeight: 'bold' }}>
              {display}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Team Model Panel ─────────────────────────────────────────────────────────

function TeamModelPanel({
  teamLabel,
  team,
  pitcher,
  model,
  odds,
  game,
  onEvaluate,
  evaluating,
}: {
  teamLabel: 'HOME' | 'AWAY';
  team: string;
  pitcher: string | null;
  model: ModelScore | null;
  odds: Odds | null;
  game: Game;
  onEvaluate: (gameId: string, team: string) => void;
  evaluating: boolean;
}) {
  const moneyline = teamLabel === 'HOME' ? odds?.homeMoneyline : odds?.awayMoneyline;
  const mlStr = moneyline !== null && moneyline !== undefined
    ? (moneyline > 0 ? `+${moneyline}` : `${moneyline}`)
    : '—';

  return (
    <div style={teamLabel === 'HOME' ? s.teamCol : s.teamColRight}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <div>
          <span style={{ fontSize: '0.6rem', color: '#555', marginRight: '0.3rem' }}>{teamLabel}</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#ddd' }}>{team}</span>
          {pitcher && (
            <span style={{ fontSize: '0.7rem', color: '#666', marginLeft: '0.4rem' }}>
              {pitcher}
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.8rem', color: '#aaa' }}>{mlStr}</span>
      </div>

      {model ? (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
            <DecisionBadge decision={model.decision} />
            <span style={{ fontSize: '0.75rem', color: model.edgePercentage !== null && model.edgePercentage > 0 ? '#4caf50' : model.edgePercentage !== null && model.edgePercentage < 0 ? '#f44336' : '#888' }}>
              Edge: {model.edgePercentage !== null ? `${model.edgePercentage > 0 ? '+' : ''}${(model.edgePercentage).toFixed(2)}%` : '—'}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#555' }}>
              Mkt: {model.marketProbability !== null ? `${(model.marketProbability * 100).toFixed(1)}%` : '—'}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>
              Mdl: {model.modelProbability !== null ? `${(model.modelProbability * 100).toFixed(1)}%` : '—'}
            </span>
            <span style={{ fontSize: '0.65rem', color: model.pitcherGatePassed ? '#4caf50' : '#f44336' }}>
              {model.pitcherGatePassed ? '✓ Gate' : '✗ Gate'}
            </span>
          </div>
          <FactorScores factors={model.factors} />
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#555' }}>Not evaluated</span>
          <button
            style={s.btn}
            onClick={() => onEvaluate(game.id, team)}
            disabled={evaluating}
          >
            {evaluating ? 'Evaluating...' : 'Evaluate'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Manual Input Panel ───────────────────────────────────────────────────────

type InjuryLevel = 'None' | 'Role Player' | 'Quality Starter' | 'Star' | 'Closer';
const INJURY_OPTIONS: InjuryLevel[] = ['None', 'Role Player', 'Quality Starter', 'Star', 'Closer'];

interface ManualInputState {
  publicBetPct: number;
  homeInjury: InjuryLevel;
  awayInjury: InjuryLevel;
  windDir: string;
  windSpeed: number;
  temp: number;
  precipPct: number;
  restFlags: Record<string, boolean>;
}

const REST_FLAGS = [
  { key: 'homeTravel', label: 'Home cross-country travel' },
  { key: 'awayTravel', label: 'Away cross-country travel' },
  { key: 'homeDH', label: 'Home doubleheader G2' },
  { key: 'awayDH', label: 'Away doubleheader G2' },
  { key: 'home4thGame', label: 'Home 4th+ consecutive game' },
  { key: 'away4thGame', label: 'Away 4th+ consecutive game' },
];

function ManualInputPanel({
  game,
  onReEvaluate,
}: {
  game: Game;
  onReEvaluate: (gameId: string, inputs: ManualInputState) => Promise<void>;
}) {
  const [inputs, setInputs] = useState<ManualInputState>({
    publicBetPct: 50,
    homeInjury: 'None',
    awayInjury: 'None',
    windDir: 'Calm',
    windSpeed: 0,
    temp: 72,
    precipPct: 0,
    restFlags: {},
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isOutdoor = game.venue ? !game.venue.toLowerCase().includes('dome') && !game.venue.toLowerCase().includes('indoor') && !game.venue.toLowerCase().includes('roof') : true;

  async function handleSubmit() {
    setSubmitting(true);
    setMsg(null);
    try {
      await onReEvaluate(game.id, inputs);
      setMsg({ type: 'ok', text: 'Re-evaluated — scores updated above' });
    } catch (err: unknown) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Evaluation failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={s.panel}>
      <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Manual Inputs — Re-run Model
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
        {/* Public Splits */}
        <div>
          <div style={s.label}>Public % on Home</div>
          <input
            type="number"
            min={0} max={100}
            value={inputs.publicBetPct}
            onChange={e => setInputs(p => ({ ...p, publicBetPct: Number(e.target.value) }))}
            style={s.input}
          />
        </div>

        {/* Home Injury */}
        <div>
          <div style={s.label}>Home Injury</div>
          <select
            value={inputs.homeInjury}
            onChange={e => setInputs(p => ({ ...p, homeInjury: e.target.value as InjuryLevel }))}
            style={s.select}
          >
            {INJURY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Away Injury */}
        <div>
          <div style={s.label}>Away Injury</div>
          <select
            value={inputs.awayInjury}
            onChange={e => setInputs(p => ({ ...p, awayInjury: e.target.value as InjuryLevel }))}
            style={s.select}
          >
            {INJURY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Weather — only if outdoor */}
        {isOutdoor && (
          <>
            <div>
              <div style={s.label}>Wind Direction</div>
              <select
                value={inputs.windDir}
                onChange={e => setInputs(p => ({ ...p, windDir: e.target.value }))}
                style={s.select}
              >
                {['Calm', 'Out', 'In', 'Cross'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <div style={s.label}>Wind Speed (mph)</div>
              <input
                type="number" min={0} max={60}
                value={inputs.windSpeed}
                onChange={e => setInputs(p => ({ ...p, windSpeed: Number(e.target.value) }))}
                style={s.input}
              />
            </div>
            <div>
              <div style={s.label}>Temperature (°F)</div>
              <input
                type="number" min={32} max={110}
                value={inputs.temp}
                onChange={e => setInputs(p => ({ ...p, temp: Number(e.target.value) }))}
                style={s.input}
              />
            </div>
            <div>
              <div style={s.label}>Precip %</div>
              <input
                type="number" min={0} max={100}
                value={inputs.precipPct}
                onChange={e => setInputs(p => ({ ...p, precipPct: Number(e.target.value) }))}
                style={s.input}
              />
            </div>
          </>
        )}
      </div>

      {/* Rest flags */}
      <div style={{ marginTop: '0.5rem' }}>
        <div style={s.label}>Rest / Schedule Flags</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.2rem', marginTop: '0.2rem' }}>
          {REST_FLAGS.map(f => (
            <label key={f.key} style={{ fontSize: '0.72rem', color: '#888', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!inputs.restFlags[f.key]}
                onChange={e => setInputs(p => ({ ...p, restFlags: { ...p.restFlags, [f.key]: e.target.checked } }))}
                style={{ accentColor: '#4caf50' }}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button style={s.btnPrimary} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Running...' : 'Re-run Model'}
        </button>
        {msg && (
          <span style={msg.type === 'ok' ? s.success : s.error}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

// ─── Bet Entry Form ───────────────────────────────────────────────────────────

function BetEntryForm({
  game,
  onBetLogged,
  onClose,
}: {
  game: Game;
  onBetLogged: () => void;
  onClose: () => void;
}) {
  const [team, setTeam] = useState<'home' | 'away'>('home');
  const [odds, setOdds] = useState('');
  const [stake, setStake] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTeam = team === 'home' ? game.homeTeam : game.awayTeam;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const oddsInt = parseInt(odds, 10);
    if (isNaN(oddsInt) || (oddsInt > -100 && oddsInt < 100)) {
      setError('Enter valid American odds (e.g. -150 or +120)');
      return;
    }
    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      setError('Enter a positive stake');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: game.id,
          teamBetOn: selectedTeam,
          oddsAtBet: oddsInt,
          stakeAmount: stakeNum,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bet entry failed');
      onBetLogged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...s.panel, borderTop: '1px solid #2d5a2d' }}>
      <div style={{ fontSize: '0.7rem', color: '#4caf50', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Log Bet
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div>
            <div style={s.label}>Team</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.78rem', color: '#aaa', display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}>
                <input type="radio" name="team" value="home" checked={team === 'home'}
                  onChange={() => setTeam('home')} style={{ accentColor: '#4caf50' }} />
                {game.homeTeam}
              </label>
              <label style={{ fontSize: '0.78rem', color: '#aaa', display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}>
                <input type="radio" name="team" value="away" checked={team === 'away'}
                  onChange={() => setTeam('away')} style={{ accentColor: '#4caf50' }} />
                {game.awayTeam}
              </label>
            </div>
          </div>
          <div>
            <div style={s.label}>Odds (American)</div>
            <input
              type="number"
              placeholder="-150"
              value={odds}
              onChange={e => setOdds(e.target.value)}
              style={s.input}
              required
            />
          </div>
          <div>
            <div style={s.label}>Stake (units)</div>
            <input
              type="number"
              placeholder="1.0"
              step="0.1"
              min="0.1"
              value={stake}
              onChange={e => setStake(e.target.value)}
              style={s.input}
              required
            />
          </div>
          <div>
            <div style={s.label}>Notes (optional)</div>
            <input
              type="text"
              placeholder="optional"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={s.input}
            />
          </div>
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" style={s.btnPrimary} disabled={submitting}>
            {submitting ? 'Logging...' : 'Log Bet'}
          </button>
          <button type="button" style={s.btn} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ─── Game Card ────────────────────────────────────────────────────────────────

function GameCard({
  game,
  onDataRefresh,
}: {
  game: Game;
  onDataRefresh: () => void;
}) {
  const [showInputs, setShowInputs] = useState(false);
  const [showBetForm, setShowBetForm] = useState(false);
  const [evaluating, setEvaluating] = useState<string | null>(null); // team abbreviation being evaluated
  const [evalError, setEvalError] = useState<string | null>(null);

  const hasBet = game.bets.length > 0;
  const betTeams = game.bets.map(b => b.teamBetOn);

  async function handleEvaluate(gameId: string, team: string) {
    setEvaluating(team);
    setEvalError(null);
    try {
      const res = await fetch(`/api/model/evaluate?gameId=${gameId}&team=${team}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Evaluation failed');
      onDataRefresh();
    } catch (err: unknown) {
      setEvalError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setEvaluating(null);
    }
  }

  async function handleReEvaluate(gameId: string, inputs: ManualInputState) {
    // Build manualInputs payload matching evaluateGame() signature
    const manualInputs: Record<string, unknown> = {
      publicBetPct: inputs.publicBetPct,
    };

    // Injury inputs
    const homeInj = inputs.homeInjury !== 'None' ? inputs.homeInjury : null;
    const awayInj = inputs.awayInjury !== 'None' ? inputs.awayInjury : null;
    if (homeInj || awayInj) {
      manualInputs.injuryInputs = { home: homeInj, away: awayInj };
    }

    // Weather
    const isOutdoor = game.venue ? !game.venue.toLowerCase().includes('dome') && !game.venue.toLowerCase().includes('indoor') : true;
    if (isOutdoor) {
      manualInputs.weatherInput = {
        windDirection: inputs.windDir,
        windSpeedMph: inputs.windSpeed,
        temperatureF: inputs.temp,
        precipitationPct: inputs.precipPct,
      };
    }

    // Rest
    const restInput: Record<string, boolean> = {};
    let hasRest = false;
    for (const [k, v] of Object.entries(inputs.restFlags)) {
      if (v) { restInput[k] = true; hasRest = true; }
    }
    if (hasRest) manualInputs.restInput = restInput;

    // Evaluate both teams with the same manual inputs
    const [homeRes, awayRes] = await Promise.all([
      fetch(`/api/model/evaluate?gameId=${gameId}&team=${game.homeTeam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualInputs),
      }),
      fetch(`/api/model/evaluate?gameId=${gameId}&team=${game.awayTeam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualInputs),
      }),
    ]);

    if (!homeRes.ok) {
      const d = await homeRes.json();
      throw new Error(`Home eval failed: ${d.error}`);
    }
    if (!awayRes.ok) {
      const d = await awayRes.json();
      throw new Error(`Away eval failed: ${d.error}`);
    }

    onDataRefresh();
  }

  function handleBetLogged() {
    setShowBetForm(false);
    onDataRefresh();
  }

  function handleLogBetClick() {
    if (hasBet) {
      // Check if user wants to override
      const confirmed = window.confirm(
        `A bet already exists on this game (${betTeams.join(', ')}). Log another bet anyway?`
      );
      if (!confirmed) return;
    }
    setShowBetForm(!showBetForm);
  }

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.cardHeader}>
        <div>
          <span style={s.teamNames}>{game.awayTeam} @ {game.homeTeam}</span>
          {game.venue && (
            <span style={{ ...s.meta, marginLeft: '0.75rem' }}>{game.venue}</span>
          )}
          <span style={{ ...s.meta, marginLeft: '0.75rem', textTransform: 'uppercase' }}>
            {game.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {hasBet && (
            <span style={s.betLogged}>
              BET LOGGED ({betTeams.join(', ')})
            </span>
          )}
          <button
            style={s.btnPrimary}
            onClick={handleLogBetClick}
          >
            Log Bet
          </button>
          <button
            style={s.btn}
            onClick={() => setShowInputs(p => !p)}
          >
            {showInputs ? '▲ Inputs' : '▼ Inputs'}
          </button>
        </div>
      </div>

      {evalError && (
        <div style={{ padding: '0.5rem 1rem', color: '#f44', fontSize: '0.75rem', background: '#1a0000' }}>
          {evalError}
        </div>
      )}

      {/* Team model rows */}
      <div style={s.row}>
        <TeamModelPanel
          teamLabel="HOME"
          team={game.homeTeam}
          pitcher={game.homePitcher}
          model={game.homeModel}
          odds={game.odds}
          game={game}
          onEvaluate={handleEvaluate}
          evaluating={evaluating === game.homeTeam}
        />
        <TeamModelPanel
          teamLabel="AWAY"
          team={game.awayTeam}
          pitcher={game.awayPitcher}
          model={game.awayModel}
          odds={game.odds}
          game={game}
          onEvaluate={handleEvaluate}
          evaluating={evaluating === game.awayTeam}
        />
      </div>

      {/* Manual input panel */}
      {showInputs && (
        <ManualInputPanel game={game} onReEvaluate={handleReEvaluate} />
      )}

      {/* Bet entry form */}
      {showBetForm && (
        <BetEntryForm game={game} onBetLogged={handleBetLogged} onClose={() => setShowBetForm(false)} />
      )}
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [date, setDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGames = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/games/today');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setGames(data.games || []);
      setDate(data.date || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load games');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '0.9rem', color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Daily Games — {date || '…'}
          </h2>
        </div>
        <button
          style={s.btn}
          onClick={fetchGames}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {loading && (
        <div style={{ color: '#555', fontSize: '0.85rem' }}>Loading games…</div>
      )}

      {error && (
        <div style={{ color: '#f44', fontSize: '0.85rem', padding: '0.5rem', background: '#1a0000', border: '1px solid #3a0000', borderRadius: '3px' }}>
          {error}
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <div style={{ color: '#555', fontSize: '0.85rem', padding: '2rem', textAlign: 'center', border: '1px solid #222', borderRadius: '4px' }}>
          No games found for {date}. Use Admin → Sync Today's Schedule to ingest games.
        </div>
      )}

      {games.map(game => (
        <GameCard key={game.id} game={game} onDataRefresh={fetchGames} />
      ))}
    </div>
  );
}
