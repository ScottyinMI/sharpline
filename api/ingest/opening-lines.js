// POST /api/ingest/opening-lines
// Task 7: captureOpeningLines() — captures opening odds for scheduled games
// that don't yet have an 'open' snapshot in odds_snapshots
// Typically run once per game (evening before or morning of)

import { select, insert, removeVig } from '../lib/supabase.js';

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

// Extract best moneyline (same logic as closing-lines — prefer sharp books)
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
// captureOpeningLines — main function
// ─────────────────────────────────────────────────────────────────────────────

export async function captureOpeningLines() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error('ODDS_API_KEY not configured');

  const log = { captured: 0, skipped: 0, errors: [] };

  // 1. Get all scheduled games with an Odds API game ID
  let scheduledGames;
  try {
    scheduledGames = await select('games', `status=eq.scheduled&odds_api_game_id=not.is.null`);
  } catch (err) {
    log.errors.push(`DB query failed: ${err.message}`);
    return log;
  }

  if (!scheduledGames.length) {
    console.log('[OPENING] No scheduled games found');
    return log;
  }

  // 2. Check which games already have an opening snapshot
  let existingOpenings;
  try {
    existingOpenings = await select(
      'odds_snapshots',
      `snapshot_type=eq.open&game_id=in.(${scheduledGames.map(g => g.id).join(',')})`
    );
  } catch (err) {
    log.errors.push(`Existing opening check failed: ${err.message}`);
    existingOpenings = [];
  }
  const alreadyCapturedGameIds = new Set(existingOpenings.map(s => s.game_id));

  const pendingGames = scheduledGames.filter(g => !alreadyCapturedGameIds.has(g.id));
  if (!pendingGames.length) {
    log.skipped = scheduledGames.length;
    console.log('[OPENING] All scheduled games already have opening snapshots');
    return log;
  }

  // 3. Fetch current odds
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

  // 4. For each pending game, capture opening line
  for (const game of pendingGames) {
    const oddsEvent = oddsData.find(e => e.id === game.odds_api_game_id);

    if (!oddsEvent) {
      // Game not in odds feed yet — too early or not listed
      log.skipped++;
      continue;
    }

    const moneyline = extractMoneyline(oddsEvent);
    if (!moneyline) {
      log.errors.push(`No moneyline for ${game.away_team} @ ${game.home_team}`);
      continue;
    }

    const { home_implied_prob, away_implied_prob } = removeVig(moneyline.home_moneyline, moneyline.away_moneyline);

    try {
      await insert('odds_snapshots', {
        game_id: game.id,
        snapshot_type: 'open',
        home_moneyline: moneyline.home_moneyline,
        away_moneyline: moneyline.away_moneyline,
        home_implied_prob,
        away_implied_prob,
        source: moneyline.source,
        captured_at: now,
      });
      log.captured++;
      console.log(`[OPENING] Captured: ${game.away_team} @ ${game.home_team} — home ${moneyline.home_moneyline} / away ${moneyline.away_moneyline}`);
    } catch (err) {
      // Ignore duplicate errors (UNIQUE or RLS may prevent exact duplicates)
      if (err.message.includes('duplicate') || err.message.includes('unique')) {
        log.skipped++;
      } else {
        log.errors.push(`Opening snapshot insert failed: ${err.message}`);
      }
    }
  }

  if (oddsRemaining) {
    console.log(`[OPENING] Odds API credits remaining: ${oddsRemaining}`);
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
    const result = await captureOpeningLines();
    summary.updated = result.captured;
    summary.skipped = result.skipped;
    summary.errors = result.errors;
    summary.success = result.errors.length === 0 || result.captured > 0;
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  return res.status(summary.success ? 200 : 500).json(summary);
}
