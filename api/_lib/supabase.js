// Shared utilities for Sharpline ingest functions
// Uses direct fetch calls to Supabase REST API — no npm dependency required

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getHeaders() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment variables not configured');
  }
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

export function getUrl(table, params = '') {
  return `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
}

// Upsert rows into a table
// conflictColumns: comma-separated column names for ON CONFLICT
export async function upsert(table, rows, conflictColumns) {
  const headers = getHeaders();
  if (conflictColumns) {
    headers['Prefer'] = `resolution=merge-duplicates,return=representation`;
  }
  const url = getUrl(table) + (conflictColumns ? `?on_conflict=${conflictColumns}` : '');
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert error on ${table}: ${res.status} ${err}`);
  }
  return res.json();
}

// Insert rows (append-only tables like team_power_ratings, odds_snapshots)
export async function insert(table, rows) {
  const headers = getHeaders();
  headers['Prefer'] = 'return=representation';
  const res = await fetch(getUrl(table), {
    method: 'POST',
    headers,
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert error on ${table}: ${res.status} ${err}`);
  }
  return res.json();
}

// Select rows
export async function select(table, params = '') {
  const res = await fetch(getUrl(table, params), {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase select error on ${table}: ${res.status} ${err}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// VIG REMOVAL — shared odds math utilities
// ─────────────────────────────────────────────────────────────────────────────

export function impliedProbability(americanOdds) {
  const odds = parseInt(americanOdds);
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Vig removal: normalize both sides so they sum to 1.000
export function removeVig(homeOdds, awayOdds) {
  const homeRaw = impliedProbability(homeOdds);
  const awayRaw = impliedProbability(awayOdds);
  const total = homeRaw + awayRaw;
  return {
    home_implied_prob: parseFloat((homeRaw / total).toFixed(6)),
    away_implied_prob: parseFloat((awayRaw / total).toFixed(6)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

// Update rows matching a filter
export async function update(table, filterParam, data) {
  const headers = getHeaders();
  headers['Prefer'] = 'return=representation';
  const res = await fetch(getUrl(table, filterParam), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase update error on ${table}: ${res.status} ${err}`);
  }
  return res.json();
}
