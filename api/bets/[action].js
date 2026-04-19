// GET|POST /api/bets/[action] — M5 Tasks 2-4: CLV, Results, Performance
// Catch-all route to stay within Vercel Hobby function limit
// Routes: calculate-clv (POST), record-results (POST), performance (GET)

import { select, insert, update } from '../../_lib/supabase.js';
import { impliedProbability, removeVig } from '../../_lib/model.js';

// ─── American → Decimal odds conversion ──────────────────────────────────────

function americanToDecimal(americanOdds) {
  const odds = Number(americanOdds);
  if (odds < 0) return (100 / Math.abs(odds)) + 1;
  return (odds / 100) + 1;
}

// ─── Task 2: calculateCLVForGame ─────────────────────────────────────────────

export async function calculateCLVForGame(gameId) {
  const log = { gameId, calculated: 0, skipped: 0, errors: [] };

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

  const { homeTrueProb: closingHomeProb, awayTrueProb: closingAwayProb } = removeVig(closingHomeML, closingAwayML);

  const games = await select('games', `id=eq.${gameId}`);
  if (games.length === 0) {
    log.errors.push(`Game not found: ${gameId}`);
    return log;
  }
  const game = games[0];

  const bets = await select('bets', `game_id=eq.${gameId}`);
  if (bets.length === 0) {
    log.skipped++;
    log.skipReason = 'No bets found for this game';
    return log;
  }

  const existingResults = await select('bet_results',
    `bet_id=in.(${bets.map(b => b.id).join(',')})`);
  const alreadyCalculated = new Set(existingResults.map(r => r.bet_id));

  for (const bet of bets) {
    if (alreadyCalculated.has(bet.id)) {
      log.skipped++;
      continue;
    }

    try {
      const isHome = bet.team_bet_on === game.home_team;
      const closingImpliedProbability = isHome ? closingHomeProb : closingAwayProb;
      const closingOdds = isHome ? closingHomeML : closingAwayML;

      const betImpliedProb = Number(bet.implied_probability_at_bet);
      const clv = closingImpliedProbability - betImpliedProb;

      await insert('bet_results', {
        bet_id: bet.id,
        closing_odds: closingOdds,
        closing_implied_probability: parseFloat(closingImpliedProbability.toFixed(6)),
        clv: parseFloat(clv.toFixed(6)),
        clv_captured_at: new Date().toISOString(),
      });

      log.calculated++;
    } catch (err) {
      log.errors.push(`CLV calc failed for bet ${bet.id}: ${err.message}`);
    }
  }

  return log;
}

// ─── Task 3: recordGameResult ────────────────────────────────────────────────

export async function recordGameResult(gameId) {
  const log = { gameId, recorded: 0, skipped: 0, errors: [] };

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

  const bets = await select('bets', `game_id=eq.${gameId}`);
  if (bets.length === 0) {
    log.skipped++;
    log.skipReason = 'No bets found for this game';
    return log;
  }

  const betResults = await select('bet_results',
    `bet_id=in.(${bets.map(b => b.id).join(',')})`);

  const resultsByBetId = {};
  for (const r of betResults) {
    resultsByBetId[r.bet_id] = r;
  }

  for (const bet of bets) {
    const existingResult = resultsByBetId[bet.id];

    if (!existingResult) {
      log.skipped++;
      continue;
    }

    if (existingResult.result !== null) {
      log.skipped++;
      continue;
    }

    try {
      const isHome = bet.team_bet_on === game.home_team;
      const teamScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;

      let result;
      if (teamScore > oppScore) {
        result = 'win';
      } else if (teamScore < oppScore) {
        result = 'loss';
      } else {
        result = 'push';
      }

      const stakeAmount = Number(bet.stake_amount);
      const decimalOdds = americanToDecimal(bet.odds_at_bet);
      let payoutAmount;

      if (result === 'win') {
        payoutAmount = parseFloat((stakeAmount * decimalOdds).toFixed(2));
      } else if (result === 'loss') {
        payoutAmount = 0;
      } else {
        payoutAmount = stakeAmount;
      }

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

// ─── Task 4: Performance aggregation ─────────────────────────────────────────

async function handlePerformance(req, res) {
  try {
    const bets = await select('bets', 'order=created_at.desc');
    const betResults = await select('bet_results', '');

    const resultsByBetId = {};
    for (const r of betResults) {
      resultsByBetId[r.bet_id] = r;
    }

    const totalBets = bets.length;
    let betsWithCLV = 0;
    let totalCLV = 0;
    let positiveCLVCount = 0;
    let resolvedBets = 0;
    let wins = 0;
    let losses = 0;
    let totalStaked = 0;
    let totalPayout = 0;

    const clvByDecision = {
      bet: { count: 0, totalCLV: 0 },
      lean: { count: 0, totalCLV: 0 },
      watchlist: { count: 0, totalCLV: 0 },
    };

    for (const bet of bets) {
      const result = resultsByBetId[bet.id];

      if (result && result.clv !== null) {
        betsWithCLV++;
        const clv = Number(result.clv);
        totalCLV += clv;
        if (clv > 0) positiveCLVCount++;

        const decision = bet.model_decision_at_bet;
        if (clvByDecision[decision]) {
          clvByDecision[decision].count++;
          clvByDecision[decision].totalCLV += clv;
        }
      }

      if (result && result.result !== null) {
        resolvedBets++;
        const stake = Number(bet.stake_amount);
        const payout = Number(result.payout_amount);
        totalStaked += stake;
        totalPayout += payout;

        if (result.result === 'win') wins++;
        if (result.result === 'loss') losses++;
      }
    }

    const averageCLV = betsWithCLV > 0 ? parseFloat((totalCLV / betsWithCLV).toFixed(6)) : 0;
    const positiveCLVPct = betsWithCLV > 0 ? parseFloat(((positiveCLVCount / betsWithCLV) * 100).toFixed(2)) : 0;
    const winPct = resolvedBets > 0 ? parseFloat(((wins / resolvedBets) * 100).toFixed(2)) : 0;
    const roi = totalStaked > 0 ? parseFloat((((totalPayout - totalStaked) / totalStaked) * 100).toFixed(2)) : 0;

    const clvByDecisionFormatted = {};
    for (const [key, val] of Object.entries(clvByDecision)) {
      clvByDecisionFormatted[key] = {
        count: val.count,
        avgCLV: val.count > 0 ? parseFloat((val.totalCLV / val.count).toFixed(6)) : 0,
      };
    }

    return res.status(200).json({
      totalBets,
      betsWithCLV,
      averageCLV,
      positiveCLVCount,
      positiveCLVPct,
      clvByDecision: clvByDecisionFormatted,
      resolvedBets,
      wins,
      losses,
      winPct,
      roi,
      totalStaked: parseFloat(totalStaked.toFixed(2)),
      totalPayout: parseFloat(totalPayout.toFixed(2)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { action } = req.query;

  switch (action) {
    case 'calculate-clv': {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed — use POST' });
      const { gameId } = req.query;
      if (!gameId) return res.status(400).json({ error: 'gameId query parameter is required' });
      try {
        const result = await calculateCLVForGame(gameId);
        return res.status(200).json({ success: true, ...result });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    case 'record-results': {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed — use POST' });
      const { gameId } = req.query;
      if (!gameId) return res.status(400).json({ error: 'gameId query parameter is required' });
      try {
        const result = await recordGameResult(gameId);
        return res.status(200).json({ success: true, ...result });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    case 'performance': {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed — use GET' });
      return handlePerformance(req, res);
    }
    default:
      return res.status(404).json({ error: `Unknown action: ${action}. Valid: calculate-clv, record-results, performance` });
  }
}
