'use client';

// app/admin/page.tsx — Admin Panel (M6 Task 6)
// Manual triggers for all ingest and evaluation endpoints.

import { useState } from 'react';

interface ButtonState {
  loading: boolean;
  result: string | null;
  error: string | null;
  ok: boolean | null;
}

function defaultState(): ButtonState {
  return { loading: false, result: null, error: null, ok: null };
}

const BUTTONS = [
  {
    key: 'schedule',
    label: "Sync Today's Schedule",
    desc: 'Ingest today\'s MLB games and probable pitchers',
    endpoint: () => {
      const today = new Date().toISOString().slice(0, 10);
      return `/api/ingest/schedule?date=${today}`;
    },
  },
  {
    key: 'opening',
    label: 'Capture Opening Lines',
    desc: 'Fetch and store opening moneylines from Odds API',
    endpoint: () => '/api/ingest/opening-lines',
  },
  {
    key: 'closing',
    label: 'Capture Closing Lines',
    desc: 'Fetch closing lines + trigger CLV auto-calculation',
    endpoint: () => '/api/ingest/closing-lines',
  },
  {
    key: 'results',
    label: 'Process Game Results',
    desc: 'Ingest final scores and update game statuses',
    endpoint: () => '/api/ingest/game-results',
  },
  {
    key: 'pitchers',
    label: 'Sync Pitcher Stats',
    desc: 'Pull latest pitcher season stats from MLB API',
    endpoint: () => '/api/ingest/pitchers',
  },
  {
    key: 'evaluate',
    label: "Evaluate Today's Games",
    desc: 'Run model on all scheduled games for today',
    endpoint: () => {
      const today = new Date().toISOString().slice(0, 10);
      return `/api/model/evaluate?date=${today}`;
    },
  },
] as const;

type ButtonKey = typeof BUTTONS[number]['key'];

function summarize(data: unknown): string {
  if (!data || typeof data !== 'object') return JSON.stringify(data, null, 2);
  const obj = data as Record<string, unknown>;

  // Pull out the most relevant top-level keys
  const keys = ['updated', 'skipped', 'errors', 'inserted', 'upserted', 'count',
                 'evaluations', 'gamesEvaluated', 'decisions', 'summary', 'success',
                 'message', 'error', 'total', 'processed'];
  const lines: string[] = [];

  for (const k of keys) {
    if (k in obj) {
      const v = obj[k];
      if (typeof v === 'object' && v !== null) {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
  }

  // Include errors array if present
  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    lines.push(`\nErrors (${obj.errors.length}):`);
    for (const e of (obj.errors as Array<Record<string, unknown>>).slice(0, 5)) {
      lines.push(`  ${JSON.stringify(e)}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : JSON.stringify(data, null, 2).slice(0, 600);
}

export default function AdminPage() {
  const [states, setStates] = useState<Record<ButtonKey, ButtonState>>(
    Object.fromEntries(BUTTONS.map(b => [b.key, defaultState()])) as Record<ButtonKey, ButtonState>
  );

  function setState(key: ButtonKey, update: Partial<ButtonState>) {
    setStates(prev => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }

  async function trigger(key: ButtonKey, endpointFn: () => string) {
    setState(key, { loading: true, result: null, error: null, ok: null });
    const url = endpointFn();
    try {
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      setState(key, {
        loading: false,
        result: summarize(data),
        ok: res.ok,
        error: null,
      });
    } catch (err: unknown) {
      setState(key, {
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : 'Request failed',
        ok: false,
      });
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 0.4rem', fontSize: '0.9rem', color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Admin
      </h2>
      <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: '1.25rem' }}>
        Manual triggers for data ingestion and model evaluation. All calls go directly to production.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {BUTTONS.map(btn => {
          const st = states[btn.key];
          return (
            <div
              key={btn.key}
              style={{
                background: '#161616',
                border: `1px solid ${st.ok === true ? '#2d5a2d' : st.ok === false ? '#5a1a1a' : '#2a2a2a'}`,
                borderRadius: '4px',
                padding: '0.85rem 1rem',
                transition: 'border-color 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#ddd', marginBottom: '0.2rem' }}>
                    {btn.label}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#555' }}>{btn.desc}</div>
                </div>
                <button
                  onClick={() => trigger(btn.key, btn.endpoint)}
                  disabled={st.loading}
                  style={{
                    flexShrink: 0,
                    marginLeft: '0.75rem',
                    background: st.loading ? '#1a1a1a' : '#1a3a1a',
                    color: st.loading ? '#555' : '#4caf50',
                    border: `1px solid ${st.loading ? '#2a2a2a' : '#2d5a2d'}`,
                    borderRadius: '3px',
                    padding: '0.3rem 0.9rem',
                    fontSize: '0.75rem',
                    cursor: st.loading ? 'wait' : 'pointer',
                    letterSpacing: '0.05em',
                    minWidth: '80px',
                    textAlign: 'center',
                  }}
                >
                  {st.loading ? (
                    <span>
                      <span style={{
                        display: 'inline-block',
                        animation: 'spin 1s linear infinite',
                        marginRight: '0.3rem',
                      }}>⟳</span>
                      Running
                    </span>
                  ) : 'Run'}
                </button>
              </div>

              {st.result && (
                <pre style={{
                  margin: '0.4rem 0 0',
                  padding: '0.5rem',
                  background: '#0d0d0d',
                  border: '1px solid #1e1e1e',
                  borderRadius: '2px',
                  fontSize: '0.68rem',
                  color: st.ok ? '#4caf50' : '#f44336',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}>
                  {st.result}
                </pre>
              )}

              {st.error && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: '#f44336' }}>
                  ✗ {st.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
