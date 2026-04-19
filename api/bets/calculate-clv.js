// POST /api/bets/calculate-clv — M5 Task 2: Automatic CLV Calculation
// Calculates CLV for all bets on a game once the closing line is captured.
// Called automatically by captureClosingLines hook, or manually via POST ?gameId={id}

import { select, insert } from '../../_lib/supabase.js';
import { impliedProbability, removeVig } from '../../_lib/model.js';

// ─── Core Function ──────────────────────────────────────────────────────────

/**
 * Calculate CLV for all bets on a game that have a closing snapshot but no bet_results row yet.
 * CLV = closingImpliedProbability − betImpliedProbability (both vig-removed)
 *
 * @param {string} gameId - UUID from games table
 * @returns {object} { calculated: N, skipped: N, errors: [] }
 */
export async function calculateCLVForGame(gameId) {
  const log = { gameId, calculated: 0, skipped: 0, errors: [] };

  // 1. Check for closing snapshot
  const closingSnapshots = await select('odds_snapshots',
    `game_id=eq.${gameId}&snapshot_type=eq.closing&order=captured_at.desc&limit=1`);

  if (closingSnapshots.length === 0) {
    log.skipped++;
    log.skipReason = 'No closing snapshot found for this game';
    return log;
  }

  const closingSnap = closingSnapshots[0];
  const closingHomeML = Number(closingSnap.home_moneyline);
  const closingAwayML = Number(closingSnap.away_moneyline);

  // 2. Vig-remove the closing line (M4 removeVig — returns { homeTrueProb, awayTrueProb })
  const { homeTrueProb: closingHomeProb, awayTrueProb: closingAwayProb } = removeVig(closingHomeML, closingAwayML);

  // 3. Fetch the game record to determine home/away mapping
  const games = await select('games', `id=eq.${gameId}`);
  if (games.length === 0) {
    log.errors.push(`Game not found: ${gameId}`);
    return log;
  }
  const game = games[0];

  // 4. Fetch all bets on this game
  const bets = await select('bets', `game_id=eq.${gameId}`);
  if (bets.length === 0) {
    log.skipped++;
    log.skipReason = 'No bets found for this game';
    return log;
  }

  // 5. Fetch existing bet_results to skip already-calculated bets
  const existingResults = await select('bet_results',
    `bet_id=in.(${bets.map(b => b.id).join(',')})`);
  const alreadyCalculated = new Set(existingResults.map(r => r.bet_id));

  // 6. Calculate CLV for each bet without a result
  for (const bet of bets) {
    if (alreadyCalculated.has(bet.id)) {
      log.skipped++;
      continue;
    }

    try {
      // Determine which side the user bet on
      const isHome = bet.team_bet_on === game.home_team;
      const closingImpliedProbability = isHome ? closingHomeProb : closingAwayProb;
      const closingOdds = isHome ? closingHomeML : closingAwayML;

      // CLV = closing implied probability − bet implied probability
      // Both are vig-removed true probabilities
      const betImpliedProb = Number(bet.implied_probability_at_bet);
      const clv = closingImpliedProbability - betImpliedProb;

      // Insert bet_results row (result and payout left null — populated by Task 3)
      await insert('bet_results', {
        bet_id: bet.id,
        closing_odds: closingOdds,
        closing_implied_probability: parseFloat(closingImpliedProbability.toFixed(6)),
        clv: parseFloat(clv.toFixed(6)),
        clv_captured_at: new Date().toISOString(),
        // result, payout_amount, result_captured_at left null
      });

      log.calculated++;
    } catch (err) {
      log.errors.push(`CLV calc failed for bet ${bet.id}: ${err.message}`);
    }
  }

  return log;
}

// ─── API Route Handler ──────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { gameId } = req.query;
  if (!gameId) {
    return res.status(400).json({ error: 'gameId query parameter is required' });
  }

  try {
    const result = await calculateCLVForGame(gameId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
