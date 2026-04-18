// POST /api/ingest/game-results
// Task 5: processGameResult(oddsApiGameId) — fetches result, calculates GPS,
//         applies 90/10 Walters formula, appends new TPR rows
// processAllFinalizedGames() — runs for all games showing Final in Odds API

import { select, insert, update } from '../lib/supabase.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// ─────────────────────────────────────────────────────────────────────────────
// WALTERS 90/10 TPR MODEL
// ─────────────────────────────────────────────────────────────────────────────

// Scale run differential to Game Performance Score (1–100)
// Win by 5+ runs: ~75–85; Loss by 5+ runs: ~15–25; Blowout: ~88–95 / ~5–12
export function calculateGPS(runDifferential) {
  // runDifferential = winner's runs - loser's runs (always positive from winner's perspective)
  // We call this from the perspective of each team (positive = won, negative = lost)
  const rd = runDifferential;

  if (rd >= 8)  return 91;   // Blowout win
  if (rd >= 5)  return 80;   // Win by 5–7
  if (rd >= 3)  return 68;   // Win by 3–4
  if (rd >= 1)  return 60;   // Win by 1–2
  if (rd === 0) return 50;   // Tie (shouldn't happen in MLB but handle it)
  if (rd >= -2) return 40;   // Loss by 1–2
  if (rd >= -4) return 31;   // Loss by 3–4
  if (rd >= -7) return 20;   // Loss by 5–7
  return 8;                  // Blowout loss (8+)
}

// Apply opponent quality modifier (+/- 3–5 points)
export function applyOpponentModifier(gps, opponentTPR) {
  if (opponentTPR > 60) return gps + 4;   // Strong opponent: +4
  if (opponentTPR < 40) return gps - 4;   // Weak opponent: -4
  return gps;                              // Average opponent: no modifier
}

// Apply 90/10 Walters decay formula
// New TPR = (0.90 × Previous TPR) + (0.10 × GPS)
export function calculateNewTPR(previousTPR, gps) {
  return parseFloat(((0.90 * previousTPR) + (0.10 * gps)).toFixed(4));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch game scores from Odds API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOddsApiScores(apiKey) {
  const url = `${ODDS_API_BASE}/sports/baseball_mlb/scores?daysFrom=1&apiKey=${apiKey}`;
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining && parseInt(remaining) < 5000) {
    console.warn(`[ODDS API CREDIT ALERT] Remaining credits: ${remaining}`);
  }
  if (!res.ok) throw new Error(`Odds API scores error: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Get current TPR for a team (most recent row)
// ─────────────────────────────────────────────────────────────────────────────

async function getCurrentTPR(teamId) {
  const rows = await select(
    'team_power_ratings',
    `team_id=eq.${teamId}&order=as_of_date.desc,created_at.desc&limit=1`
  );
  if (!rows.length) throw new Error(`No TPR found for team: ${teamId}`);
  return {
    rating_value: parseFloat(rows[0].rating_value),
    games_included: parseInt(rows[0].games_included || 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// processGameResult — core TPR update function
// ─────────────────────────────────────────────────────────────────────────────

export async function processGameResult(oddsApiGameId, scoreData = null) {
  const apiKey = process.env.ODDS_API_KEY;
  const log = { oddsApiGameId, homeTeam: null, awayTeam: null, processed: false, skipped: false, errors: [] };

  // 1. Look up the game in our DB
  let dbGames;
  try {
    dbGames = await select('games', `odds_api_game_id=eq.${oddsApiGameId}&limit=1`);
  } catch (err) {
    log.errors.push(`DB lookup failed: ${err.message}`);
    return log;
  }

  if (!dbGames.length) {
    log.errors.push(`Game not found in DB for odds_api_game_id: ${oddsApiGameId}`);
    return log;
  }

  const game = dbGames[0];
  log.homeTeam = game.home_team;
  log.awayTeam = game.away_team;

  // 2. Idempotency: skip if already marked final
  if (game.status === 'final') {
    log.skipped = true;
    log.skippedReason = 'Game already marked final — TPR already updated';
    return log;
  }

  // 3. Get score data (from passed scoreData or fetch fresh)
  let scoreEntry = scoreData;
  if (!scoreEntry) {
    try {
      const scores = await fetchOddsApiScores(apiKey);
      scoreEntry = scores.find(s => s.id === oddsApiGameId);
    } catch (err) {
      log.errors.push(`Odds API scores fetch failed: ${err.message}`);
      return log;
    }
  }

  if (!scoreEntry || !scoreEntry.completed) {
    log.skipped = true;
    log.skippedReason = `Game not yet final in Odds API (completed=false or not found)`;
    return log;
  }

  // 4. Extract scores
  const homeScore = scoreEntry.scores?.find(s => s.name === scoreEntry.home_team)?.score;
  const awayScore = scoreEntry.scores?.find(s => s.name === scoreEntry.away_team)?.score;

  if (homeScore == null || awayScore == null) {
    log.errors.push(`Missing score data: home=${homeScore} away=${awayScore}`);
    return log;
  }

  const homeRuns = parseInt(homeScore);
  const awayRuns = parseInt(awayScore);
  const today = new Date().toISOString().split('T')[0];

  // 5. Get current TPR for both teams
  let homeTPR, awayTPR;
  try {
    homeTPR = await getCurrentTPR(game.home_team);
    awayTPR = await getCurrentTPR(game.away_team);
  } catch (err) {
    log.errors.push(`TPR lookup failed: ${err.message}`);
    return log;
  }

  // 6. Calculate GPS for each team (run differential from each team's perspective)
  const homeRunDiff = homeRuns - awayRuns;
  const awayRunDiff = awayRuns - homeRuns;

  const homeGPS_raw = calculateGPS(homeRunDiff);
  const awayGPS_raw = calculateGPS(awayRunDiff);

  // Apply opponent quality modifier using current TPR
  const homeGPS = applyOpponentModifier(homeGPS_raw, awayTPR.rating_value);
  const awayGPS = applyOpponentModifier(awayGPS_raw, homeTPR.rating_value);

  // 7. Calculate new TPR (Walters 90/10)
  const newHomeTPR = calculateNewTPR(homeTPR.rating_value, homeGPS);
  const newAwayTPR = calculateNewTPR(awayTPR.rating_value, awayGPS);

  // 8. Log the calculation for verification
  console.log(`[TPR UPDATE] ${game.away_team} @ ${game.home_team}: ${awayRuns}-${homeRuns}`);
  console.log(`  Home (${game.home_team}): prevTPR=${homeTPR.rating_value}, GPS=${homeGPS} (raw=${homeGPS_raw}), newTPR=${newHomeTPR}`);
  console.log(`  Away (${game.away_team}): prevTPR=${awayTPR.rating_value}, GPS=${awayGPS} (raw=${awayGPS_raw}), newTPR=${newAwayTPR}`);

  // 9. Update game record with final scores and status FIRST — this sets the
  //    idempotency guard (status='final'). If the TPR insert below fails, a
  //    retry will skip this game correctly rather than double-updating TPR.
  try {
    await update('games', `odds_api_game_id=eq.${oddsApiGameId}`, {
      status: 'final',
      home_score: homeRuns,
      away_score: awayRuns,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    log.errors.push(`Game status update failed (aborting before TPR write): ${err.message}`);
    return log;
  }

  // 10. Append new TPR rows (NEVER UPDATE existing rows)
  //     Game is already marked final above — retry-safe.
  try {
    await insert('team_power_ratings', {
      team_id: game.home_team,
      rating_value: newHomeTPR,
      previous_rating_value: homeTPR.rating_value,
      game_performance_score: homeGPS,
      games_included: homeTPR.games_included + 1,
      as_of_date: today,
    });

    await insert('team_power_ratings', {
      team_id: game.away_team,
      rating_value: newAwayTPR,
      previous_rating_value: awayTPR.rating_value,
      game_performance_score: awayGPS,
      games_included: awayTPR.games_included + 1,
      as_of_date: today,
    });
  } catch (err) {
    log.errors.push(`TPR insert failed: ${err.message}`);
    return log;
  }

  log.processed = true;
  log.calculation = {
    score: `${game.away_team} ${awayRuns} @ ${game.home_team} ${homeRuns}`,
    home: { prevTPR: homeTPR.rating_value, gps: homeGPS, newTPR: newHomeTPR },
    away: { prevTPR: awayTPR.rating_value, gps: awayGPS, newTPR: newAwayTPR },
  };

  return log;
}

// ─────────────────────────────────────────────────────────────────────────────
// processAllFinalizedGames — batch processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processAllFinalizedGames() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not configured');

  const summary = { processed: 0, skipped: 0, errors: [] };

  // Fetch all pending/in-progress games from our DB
  let pendingGames;
  try {
    pendingGames = await select('games', `status=in.(scheduled,in_progress)&odds_api_game_id=not.is.null`);
  } catch (err) {
    summary.errors.push(`DB query failed: ${err.message}`);
    return summary;
  }

  if (!pendingGames.length) {
    console.log('[GAME-RESULTS] No pending games to process');
    return summary;
  }

  // Fetch scores from Odds API once (batch)
  let scores;
  try {
    scores = await fetchOddsApiScores(apiKey);
  } catch (err) {
    summary.errors.push(`Odds API scores fetch failed: ${err.message}`);
    return summary;
  }

  // Process each game that shows as completed in Odds API
  for (const game of pendingGames) {
    const scoreEntry = scores.find(s => s.id === game.odds_api_game_id);
    if (!scoreEntry || !scoreEntry.completed) {
      summary.skipped++;
      continue;
    }

    const result = await processGameResult(game.odds_api_game_id, scoreEntry);
    if (result.processed) summary.processed++;
    else if (result.skipped) summary.skipped++;
    if (result.errors.length) summary.errors.push(...result.errors);
  }

  console.log(`[GAME-RESULTS] ${summary.processed} processed, ${summary.skipped} skipped`);
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Route handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { game_id } = req.query;
  const summary = { success: true, updated: 0, skipped: 0, errors: [] };

  try {
    if (game_id) {
      const result = await processGameResult(game_id);
      summary.updated = result.processed ? 1 : 0;
      summary.skipped = result.skipped ? 1 : 0;
      summary.errors = result.errors;
      summary.detail = result.calculation;
      summary.success = result.processed || result.skipped;
    } else {
      const result = await processAllFinalizedGames();
      summary.updated = result.processed;
      summary.skipped = result.skipped;
      summary.errors = result.errors;
      summary.success = result.errors.length === 0 || result.processed > 0;
    }
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  return res.status(summary.success ? 200 : 500).json(summary);
}
