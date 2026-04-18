// POST /api/ingest/pitchers
// Task 2: syncPitcherStats(pitcherId, season) — season-level stats
// Task 3: syncPitcherRecentForm(pitcherId) — per-start game log
// syncAllActivePitchers(season) — iterates all starters with games_started > 0

import { upsert } from '../lib/supabase.js';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: Season-level pitcher stats
// ─────────────────────────────────────────────────────────────────────────────

export async function syncPitcherStats(pitcherId, season) {
  const url = `${MLB_API_BASE}/people/${pitcherId}/stats?stats=season&season=${season}&group=pitching`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API pitcher stats error: ${res.status} for pitcher ${pitcherId}`);
  const data = await res.json();

  const stats = data.stats?.[0]?.splits?.[0]?.stat;
  const name = data.stats?.[0]?.splits?.[0]?.player?.fullName || `Pitcher ${pitcherId}`;

  if (!stats) {
    return { pitcherId, name, status: 'no_stats', updated: false };
  }

  const row = {
    pitcher_id: String(pitcherId),
    pitcher_name: name,
    season: parseInt(season),
    era: stats.era ? parseFloat(stats.era) : null,
    whip: stats.whip ? parseFloat(stats.whip) : null,
    k_per_9: stats.strikeoutsPer9Inn ? parseFloat(stats.strikeoutsPer9Inn) : null,
    games_started: stats.gamesStarted ? parseInt(stats.gamesStarted) : null,
    innings_pitched: stats.inningsPitched ? parseFloat(stats.inningsPitched) : null,
    last_updated: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await upsert('pitcher_stats', row, 'pitcher_id,season');
  return { pitcherId, name, status: 'updated', updated: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3: Per-start recent form
// ─────────────────────────────────────────────────────────────────────────────

export async function syncPitcherRecentForm(pitcherId, season = 2026) {
  const url = `${MLB_API_BASE}/people/${pitcherId}/stats?stats=gameLog&season=${season}&group=pitching`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API game log error: ${res.status} for pitcher ${pitcherId}`);
  const data = await res.json();

  const splits = data.stats?.[0]?.splits || [];
  const name = splits[0]?.player?.fullName || `Pitcher ${pitcherId}`;

  // Take last 5 starts only
  const starts = splits
    .filter(s => s.stat?.gamesStarted === '1' || parseInt(s.stat?.gamesStarted) === 1)
    .slice(-5);

  if (starts.length === 0) {
    return { pitcherId, name, status: 'no_starts', updated: 0 };
  }

  const rows = starts.map(s => {
    const stat = s.stat;
    const ip = parseFloat(stat?.inningsPitched || 0);
    const er = parseInt(stat?.earnedRuns || 0);
    const h = parseInt(stat?.hits || 0);
    const bb = parseInt(stat?.baseOnBalls || 0);

    // ERA for this start = earned runs / innings pitched × 9
    const eraForStart = ip > 0 ? parseFloat(((er / ip) * 9).toFixed(2)) : null;
    // WHIP for this start = (H + BB) / IP
    const whipForStart = ip > 0 ? parseFloat(((h + bb) / ip).toFixed(3)) : null;

    return {
      pitcher_id: String(pitcherId),
      pitcher_name: name,
      game_date: s.date || null,
      opponent: s.opponent?.name ? s.opponent.name : null,
      innings_pitched: ip || null,
      era_for_start: eraForStart,
      whip_for_start: whipForStart,
      home_or_away: s.isHome ? 'home' : 'away',
      mlb_game_pk: s.game?.gamePk ? parseInt(s.game.gamePk) : null,
    };
  }).filter(r => r.mlb_game_pk !== null); // only store starts we can deduplicate

  if (rows.length === 0) {
    return { pitcherId, name, status: 'no_deduplicatable_starts', updated: 0 };
  }

  // Upsert with UNIQUE constraint on (pitcher_id, mlb_game_pk)
  await upsert('pitcher_recent_form', rows, 'pitcher_id,mlb_game_pk');
  return { pitcherId, name, status: 'updated', updated: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch all active MLB pitchers for a season (games_started > 0)
// Uses the stats leaders endpoint to find all starters
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllActivePitcherIds(season) {
  // Fetch pitching stats leaders — returns all pitchers with stats this season
  // leaderCategories=wins gives us all pitchers; filter to GS > 0
  const url = `${MLB_API_BASE}/stats?stats=season&season=${season}&group=pitching&sportId=1&playerPool=ALL&limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API all pitchers error: ${res.status}`);
  const data = await res.json();

  const splits = data.stats?.[0]?.splits || [];
  const starters = splits.filter(s => {
    const gs = parseInt(s.stat?.gamesStarted || 0);
    return gs > 0;
  });

  return starters.map(s => ({
    id: String(s.player?.id),
    name: s.player?.fullName || `ID ${s.player?.id}`,
  })).filter(p => p.id && p.id !== 'undefined');
}

export async function syncAllActivePitchers(season = 2026) {
  const log = { season, statsUpdated: 0, formUpdated: 0, skipped: 0, errors: [] };

  let pitchers;
  try {
    pitchers = await fetchAllActivePitcherIds(season);
    console.log(`[PITCHERS] Found ${pitchers.length} active starters for ${season}`);
  } catch (err) {
    log.errors.push(`Failed to fetch pitcher list: ${err.message}`);
    return log;
  }

  for (const pitcher of pitchers) {
    // Season stats
    try {
      const result = await syncPitcherStats(pitcher.id, season);
      if (result.updated) log.statsUpdated++;
      else log.skipped++;
    } catch (err) {
      log.errors.push(`Stats failed for ${pitcher.name} (${pitcher.id}): ${err.message}`);
    }

    // Recent form
    try {
      const result = await syncPitcherRecentForm(pitcher.id, season);
      log.formUpdated += result.updated || 0;
    } catch (err) {
      log.errors.push(`Form failed for ${pitcher.name} (${pitcher.id}): ${err.message}`);
    }

    // Small delay to avoid hammering MLB API
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`[PITCHERS] Stats: ${log.statsUpdated} updated, ${log.skipped} skipped. Form: ${log.formUpdated} starts stored.`);
  return log;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Route handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { pitcher_id, season = '2026', mode } = req.query;
  const summary = { success: true, updated: 0, skipped: 0, errors: [] };

  try {
    if (pitcher_id) {
      // Single pitcher
      const statsResult = await syncPitcherStats(pitcher_id, parseInt(season));
      const formResult = await syncPitcherRecentForm(pitcher_id, parseInt(season));
      summary.updated = (statsResult.updated ? 1 : 0) + (formResult.updated || 0);
      summary.skipped = statsResult.updated ? 0 : 1;
      summary.detail = { stats: statsResult, form: formResult };
    } else {
      // All active pitchers
      const result = await syncAllActivePitchers(parseInt(season));
      summary.updated = result.statsUpdated + result.formUpdated;
      summary.skipped = result.skipped;
      summary.errors = result.errors;
      summary.detail = result;
      summary.success = result.errors.length === 0 || result.statsUpdated > 0;
    }
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  return res.status(summary.success ? 200 : 500).json(summary);
}
