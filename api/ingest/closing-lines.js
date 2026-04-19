// POST /api/ingest/closing-lines
// Task 6: captureClosingLines() — detects game-start transitions,
//         captures last odds as closing snapshot, updates games.status to in_progress
// Designed to run every 10 minutes on game days
// Includes late-closing-line recovery for missed captures
// M5 HOOK: After capturing a closing line, automatically calculates CLV for any bets on that game

import { select, insert, update, removeVig } from '../_lib/supabase.js';
import { calculateCLVForGame } from '../bets/[action].js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// ─────────────────────────────────────────────────────────────────────────────
// Fetch current odds from Odds API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCurrentOdds(apiKey) {
  const url = `${ODDS_API_BASE}/sports/baseball_mlb/odds?regions=us&markets=h2h&apiKey=${apiKey}&oddsFormat=american`;
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining && parseInt(remaining) < 5000) {
    console.warn(`[ODDS API CREDIT ALERT] Remaining credits: ${remaining}`);
  }
  if (!res.ok) throw new Error(`Odds API odds error: ${res.status}`);
  return { data: await res.json(), remaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract best available moneyline from bookmakers array
// Prefer DraftKings → FanDuel → BetMGM → first available
// ─────────────────────────────────────────────────────────────────────────────

function extractMoneyline(oddsEvent) {
  const PREFERRED_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'pointsbetus', 'williamhill_us'];

  for (const bookKey of PREFERRED_BOOKS) {
    const book = oddsEvent.bookmakers?.find(b => b.key === bookKey);
    if (!book) continue;
    const market = book.markets?.find(m => m.key === 'h2h');
    if (!market?.outcomes?.length) continue;

    const homeOutcome = market.outcomes.find(o => o.name === oddsEvent.home_team);
    const awayOutcome = market.outcomes.find(o => o.name === oddsEvent.away_team);
    if (homeOutcome && awayOutcome) {
      return {
        home_moneyline: parseInt(homeOutcome.price),
        away_moneyline: parseInt(awayOutcome.price),
        source: bookKey,
      };
    }
  }

  // Fall back to first available bookmaker
  for (const book of (oddsEvent.bookmakers || [])) {
    const market = book.markets?.find(m => m.key === 'h2h');
    if (!market?.outcomes?.length) continue;
    const homeOutcome = market.outcomes.find(o => o.name === oddsEvent.home_team);
    const awayOutcome = market.outcomes.find(o => o.name === oddsEvent.away_team);
    if (homeOutcome && awayOutcome) {
      return {
        home_moneyline: parseInt(homeOutcome.price),
        away_moneyline: parseInt(awayOutcome.price),
        source: book.key,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: captureClosingLines
// ─────────────────────────────────────────────────────────────────────────────

export async function captureClosingLines() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not configured');

  const log = { captured: 0, skipped: 0, lateCaptures: 0, clvCalculated: 0, errors: [] };
  const today = new Date().toISOString().split('T')[0];

  // 1. Get all scheduled games for today
  let scheduledGames;
  try {
    scheduledGames = await select('games', `status=in.(scheduled,in_progress)&date=eq.${today}&odds_api_game_id=not.is.null`);
  } catch (err) {
    log.errors.push(`DB query failed: ${err.message}`);
    return log;
  }

  if (!scheduledGames.length) {
    console.log('[CLOSING] No scheduled games today');
    return log;
  }

  // 2. Check which games already have a closing snapshot
  let existingClosings;
  try {
    existingClosings = await select(
      'odds_snapshots',
      `snapshot_type=eq.closing&game_id=in.(${scheduledGames.map(g => g.id).join(',')})`
    );
  } catch (err) {
    log.errors.push(`Existing closing check failed: ${err.message}`);
    existingClosings = [];
  }
  const alreadyCapturedGameIds = new Set(existingClosings.map(s => s.game_id));

  // Games still needing closing lines
  const pendingGames = scheduledGames.filter(g => !alreadyCapturedGameIds.has(g.id));
  if (!pendingGames.length) {
    log.skipped = scheduledGames.length;
    console.log('[CLOSING] All games already have closing snapshots');
    return log;
  }

  // 3. Fetch current odds from Odds API
  let oddsData, oddsRemaining;
  try {
    const result = await fetchCurrentOdds(apiKey);
    oddsData = result.data;
    oddsRemaining = result.remaining;
  } catch (err) {
    log.errors.push(`Odds API fetch failed: ${err.message}`);
    return log;
  }

  const now = new Date().toISOString();

  // 4. For each pending game, check if Odds API shows it as commenced
  for (const game of pendingGames) {
    const oddsEvent = oddsData.find(e => e.id === game.odds_api_game_id);

    if (!oddsEvent) {
      // Game not in odds feed — may have started and been removed
      // Check if game is in_progress in our DB and attempt late capture
      if (game.status === 'in_progress') {
        log.skipped++;
        console.log(`[CLOSING] ${game.away_team} @ ${game.home_team}: in_progress but not in odds feed — cannot capture late`);
      } else {
        log.skipped++;
      }
      continue;
    }

    // Check if game has commenced (Odds API removes the game from the feed or marks it)
    const gameCommenceTime = new Date(oddsEvent.commence_time);
    const now_ts = new Date();
    const hasCommenced = now_ts >= gameCommenceTime;

    if (!hasCommenced) {
      // Game hasn't started yet — this is not the closing line yet
      log.skipped++;
      continue;
    }

    // Game has commenced — these ARE the closing odds (last before game start)
    const moneyline = extractMoneyline(oddsEvent);
    if (!moneyline) {
      log.errors.push(`No moneyline found for ${game.away_team} @ ${game.home_team}`);
      continue;
    }

    const { home_implied_prob, away_implied_prob } = removeVig(moneyline.home_moneyline, moneyline.away_moneyline);

    // Determine source field — flag late captures
    const isLate = game.status === 'in_progress';
    const source = isLate ? `late_closing:${moneyline.source}` : moneyline.source;

    // 5. Write closing snapshot to odds_snapshots (append-only)
    try {
      await insert('odds_snapshots', {
        game_id: game.id,
        snapshot_type: 'closing',
        home_moneyline: moneyline.home_moneyline,
        away_moneyline: moneyline.away_moneyline,
        home_implied_prob,
        away_implied_prob,
        source,
        captured_at: now,
      });
    } catch (err) {
      log.errors.push(`Closing snapshot insert failed for game ${game.id}: ${err.message}`);
      continue;
    }

    // 6. Update game status to in_progress (if not already)
    if (game.status !== 'in_progress') {
      try {
        await update('games', `id=eq.${game.id}`, {
          status: 'in_progress',
          updated_at: now,
        });
      } catch (err) {
        log.errors.push(`Game status update failed: ${err.message}`);
      }
    }

    // 7. M5 HOOK — Automatically calculate CLV for any bets on this game
    try {
      const clvResult = await calculateCLVForGame(game.id);
      log.clvCalculated += clvResult.calculated;
      if (clvResult.errors.length) {
        log.errors.push(...clvResult.errors.map(e => `CLV: ${e}`));
      }
      if (clvResult.calculated > 0) {
        console.log(`[CLOSING] CLV calculated for ${clvResult.calculated} bet(s) on ${game.away_team} @ ${game.home_team}`);
      }
    } catch (err) {
      log.errors.push(`CLV auto-calculation failed for game ${game.id}: ${err.message}`);
    }

    if (isLate) {
      log.lateCaptures++;
      console.log(`[CLOSING] LATE capture: ${game.away_team} @ ${game.home_team} — source: ${source}`);
    } else {
      log.captured++;
      console.log(`[CLOSING] Captured closing line: ${game.away_team} @ ${game.home_team} — home ${moneyline.home_moneyline} / away ${moneyline.away_moneyline} — vig-removed: ${home_implied_prob} / ${away_implied_prob}`);
    }
  }

  if (oddsRemaining) {
    console.log(`[CLOSING] Odds API credits remaining: ${oddsRemaining}`);
  }

  return log;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Route handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const summary = { success: true, updated: 0, skipped: 0, errors: [] };

  try {
    const result = await captureClosingLines();
    summary.updated = result.captured + result.lateCaptures;
    summary.skipped = result.skipped;
    summary.errors = result.errors;
    summary.lateCaptures = result.lateCaptures;
    summary.clvCalculated = result.clvCalculated;
    summary.success = result.errors.length === 0 || result.captured > 0;
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  return res.status(summary.success ? 200 : 500).json(summary);
}
