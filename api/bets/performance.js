// GET /api/bets/performance — M5 Task 4: CLV Aggregation API
// Returns performance metrics across all bets with CLV calculated.

import { select } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed — use GET' });
  }

  try {
    // Fetch all bets
    const bets = await select('bets', 'order=created_at.desc');

    // Fetch all bet_results
    const betResults = await select('bet_results', '');

    // Build lookup by bet_id
    const resultsByBetId = {};
    for (const r of betResults) {
      resultsByBetId[r.bet_id] = r;
    }

    // ── Aggregate ──
    const totalBets = bets.length;
    let betsWithCLV = 0;
    let totalCLV = 0;
    let positiveCLVCount = 0;
    let resolvedBets = 0;
    let wins = 0;
    let losses = 0;
    let totalStaked = 0;
    let totalPayout = 0;

    // CLV by decision tier
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

        // Aggregate by decision tier
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

    // Calculate averages
    const averageCLV = betsWithCLV > 0 ? parseFloat((totalCLV / betsWithCLV).toFixed(6)) : 0;
    const positiveCLVPct = betsWithCLV > 0 ? parseFloat(((positiveCLVCount / betsWithCLV) * 100).toFixed(2)) : 0;
    const winPct = resolvedBets > 0 ? parseFloat(((wins / resolvedBets) * 100).toFixed(2)) : 0;
    const roi = totalStaked > 0 ? parseFloat((((totalPayout - totalStaked) / totalStaked) * 100).toFixed(2)) : 0;

    // Format CLV by decision
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
