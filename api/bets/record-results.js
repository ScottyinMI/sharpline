// POST /api/bets/record-results — M5 Task 3: Game Result Recording
// After a game finalizes, updates bet_results with win/loss/push/void and payout.
// Requires: game already has home_score/away_score set (by M3 processGameResult)
//           and bet_results row already exists with CLV (from Task 2).
// Callable via POST ?gameId={id}

import { select, update } from '../../_lib/supabase.js';

// ─── Decimal Odds Conversion ────────────────────────────────────────────────

/**
 * Convert American odds to decimal odds.
 * Negative: decimal = (100 / |odds|) + 1
 * Positive: decimal = (odds / 100) + 1
 */
function americanToDecimal(americanOdds) {
  const odds = Number(americanOdds);
  if (odds < 0) return (100 / Math.abs(odds)) + 1;
  return (odds / 100) + 1;
}

// ─── Core Function ──────────────────────────────────────────────────────────

/**
 * Record game results for all bets on a finalized game.
 * Determines win/loss/push/void, calculates payout.
 *
 * @param {string} gameId - UUID from games table
 * @returns {object} { recorded: N, skipped: N, errors: [] }
 */
export async function recordGameResult(gameId) {
  const log = { gameId, recorded: 0, skipped: 0, errors: [] };

  // 1. Fetch game and verify it's final with scores
  const games = await select('games', `id=eq.${gameId}`);
  if (games.length === 0) {
    log.errors.push(`Game not found: ${gameId}`);
    return log;
  }
  const game = games[0];

  if (game.status !== 'final') {
    log.skipped++;
    log.skipReason = `Game status is '${game.status}' — must be 'final'`;
    return log;
  }

  if (game.home_score === null || game.away_score === null) {
    log.errors.push('Game is final but scores are missing');
    return log;
  }

  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);

  // 2. Fetch all bets on this game
  const bets = await select('bets', `game_id=eq.${gameId}`);
  if (bets.length === 0) {
    log.skipped++;
    log.skipReason = 'No bets found for this game';
    return log;
  }

  // 3. Fetch bet_results for these bets (only process those with CLV already calculated)
  const betResults = await select('bet_results',
    `bet_id=in.(${bets.map(b => b.id).join(',')})`);

  // Build lookup
  const resultsByBetId = {};
  for (const r of betResults) {
    resultsByBetId[r.bet_id] = r;
  }

  // 4. Process each bet
  for (const bet of bets) {
    const existingResult = resultsByBetId[bet.id];

    if (!existingResult) {
      log.skipped++;
      continue; // No bet_results row — CLV not yet calculated
    }

    // Skip if result already recorded
    if (existingResult.result !== null) {
      log.skipped++;
      continue;
    }

    try {
      // Determine win/loss/push
      const isHome = bet.team_bet_on === game.home_team;
      const teamScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;

      let result;
      if (teamScore > oppScore) {
        result = 'win';
      } else if (teamScore < oppScore) {
        result = 'loss';
      } else {
        result = 'push'; // Tie — shouldn't happen in MLB regulation but handle it
      }

      // Calculate payout
      const stakeAmount = Number(bet.stake_amount);
      const decimalOdds = americanToDecimal(bet.odds_at_bet);
      let payoutAmount;

      if (result === 'win') {
        // Payout = stake × (decimal odds − 1) + stake = stake × decimal odds
        payoutAmount = parseFloat((stakeAmount * decimalOdds).toFixed(2));
      } else if (result === 'loss') {
        payoutAmount = 0;
      } else {
        // Push or void: return stake
        payoutAmount = stakeAmount;
      }

      // Update the existing bet_results row
      await update('bet_results', `id=eq.${existingResult.id}`, {
        result,
        payout_amount: payoutAmount,
        result_captured_at: new Date().toISOString(),
      });

      log.recorded++;
    } catch (err) {
      log.errors.push(`Result recording failed for bet ${bet.id}: ${err.message}`);
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
    const result = await recordGameResult(gameId);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
