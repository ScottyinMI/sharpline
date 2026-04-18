// POST /api/ingest/schedule?date=YYYY-MM-DD
// Syncs MLB schedule for a given date (or next 7 days if no date given)
// Upserts games table with mlb_game_pk, team abbreviations, probable pitchers
// Then matches Odds API game IDs by fetching that date's MLB events

import { upsert, select, update } from '../lib/supabase.js';
import { normalizeTeam, teamsMatch, ODDS_API_TEAM_MAP } from '../lib/teamMap.js';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Fetch MLB schedule for a single date
async function fetchMLBSchedule(date) {
  const url = `${MLB_API_BASE}/schedule?sportId=1&date=${date}&hydrate=probablePitchers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);
  return res.json();
}

// Fetch Odds API MLB events for upcoming games (returns events array)
async function fetchOddsApiEvents(apiKey) {
  const url = `${ODDS_API_BASE}/sports/baseball_mlb/events?apiKey=${apiKey}`;
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining && parseInt(remaining) < 5000) {
    console.warn(`[ODDS API CREDIT ALERT] Remaining credits: ${remaining}`);
  }
  if (!res.ok) throw new Error(`Odds API events error: ${res.status}`);
  return res.json();
}

// Parse MLB schedule response into game rows
function parseMLBGames(data, targetDate) {
  const games = [];
  for (const date of data.dates || []) {
    for (const game of date.games || []) {
      const homeName = game.teams?.home?.team?.name;
      const awayName = game.teams?.away?.team?.name;
      const homeAbbr = normalizeTeam(homeName);
      const awayAbbr = normalizeTeam(awayName);

      if (!homeAbbr || !awayAbbr) {
        console.warn(`[SCHEDULE] Could not normalize team names: home="${homeName}" away="${awayName}"`);
      }

      const homePitcher = game.teams?.home?.probablePitcher?.fullName || null;
      const awayPitcher = game.teams?.away?.probablePitcher?.fullName || null;
      const venue = game.venue?.name || null;
      const mlbGamePk = game.gamePk;

      // Map MLB game status to our schema CHECK constraint values
      const rawStatus = game.status?.abstractGameState || 'Preview';
      let status = 'scheduled';
      if (rawStatus === 'Live') status = 'in_progress';
      if (rawStatus === 'Final') status = 'final';

      games.push({
        date: targetDate,
        home_team: homeAbbr || homeName,
        away_team: awayAbbr || awayName,
        home_pitcher: homePitcher,
        away_pitcher: awayPitcher,
        venue,
        mlb_game_pk: mlbGamePk,
        status,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return games;
}

// Match Odds API events to our games by home + away team names
function matchOddsApiIds(dbGames, oddsEvents) {
  const matched = [];
  for (const game of dbGames) {
    const match = oddsEvents.find(event => {
      const oddsHome = normalizeTeam(event.home_team, ODDS_API_TEAM_MAP);
      const oddsAway = normalizeTeam(event.away_team, ODDS_API_TEAM_MAP);
      return oddsHome === game.home_team && oddsAway === game.away_team;
    });
    if (match) {
      matched.push({ mlb_game_pk: game.mlb_game_pk, odds_api_game_id: match.id });
    } else {
      console.warn(`[SCHEDULE] No Odds API match for: ${game.away_team} @ ${game.home_team}`);
    }
  }
  return matched;
}

// Main sync function
export async function syncSchedule(date) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not configured');

  const log = { date, updated: 0, skipped: 0, oddsMatched: 0, errors: [] };

  // 1. Fetch MLB schedule
  let mlbData;
  try {
    mlbData = await fetchMLBSchedule(date);
  } catch (err) {
    log.errors.push(`MLB fetch failed: ${err.message}`);
    return log;
  }

  const games = parseMLBGames(mlbData, date);
  if (games.length === 0) {
    log.skipped = 0;
    console.log(`[SCHEDULE] No games found for ${date}`);
    return log;
  }

  // 2. Upsert games into DB (conflict on mlb_game_pk)
  try {
    await upsert('games', games, 'mlb_game_pk');
    log.updated = games.length;
  } catch (err) {
    log.errors.push(`DB upsert failed: ${err.message}`);
    return log;
  }

  // 3. Fetch Odds API events and match IDs
  let oddsEvents = [];
  try {
    oddsEvents = await fetchOddsApiEvents(apiKey);
  } catch (err) {
    log.errors.push(`Odds API fetch failed (non-blocking): ${err.message}`);
    // Don't return — we still successfully upserted MLB data
  }

  if (oddsEvents.length > 0) {
    const matches = matchOddsApiIds(games, oddsEvents);
    for (const m of matches) {
      try {
        await update('games', `mlb_game_pk=eq.${m.mlb_game_pk}`, {
          odds_api_game_id: m.odds_api_game_id,
          updated_at: new Date().toISOString(),
        });
        log.oddsMatched++;
      } catch (err) {
        log.errors.push(`Odds ID update failed for game ${m.mlb_game_pk}: ${err.message}`);
      }
    }
  }

  console.log(`[SCHEDULE] ${date}: ${log.updated} games upserted, ${log.oddsMatched} Odds API IDs matched`);
  return log;
}

// API Route handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { date } = req.query;
  const summary = { success: true, updated: 0, skipped: 0, errors: [] };

  try {
    if (date) {
      // Single date
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format — use YYYY-MM-DD' });
      }
      const result = await syncSchedule(date);
      summary.updated = result.updated;
      summary.skipped = result.skipped;
      summary.oddsMatched = result.oddsMatched;
      if (result.errors.length > 0) {
        summary.errors = result.errors;
        summary.success = result.updated > 0; // partial success if some worked
      }
    } else {
      // Default: sync next 7 days
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
      }
      for (const d of dates) {
        const result = await syncSchedule(d);
        summary.updated += result.updated;
        summary.skipped += result.skipped;
        summary.errors.push(...result.errors);
      }
    }
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  const statusCode = summary.success ? 200 : 500;
  return res.status(statusCode).json(summary);
}
