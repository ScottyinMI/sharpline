// POST /api/bets — M5 Task 1: Bet Entry API
// GET  /api/bets — M5 Task 5: Bet Retrieval API
// Records a bet with model context, or retrieves all bets with results

import { select, insert } from './_lib/supabase.js';
import { impliedProbability, removeVig } from './_lib/model.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGetBets(req, res);
  }
  if (req.method === 'POST') {
    return handlePostBet(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed — use GET or POST' });
}

// ─── Task 5: GET /api/bets ──────────────────────────────────────────────────
async function handleGetBets(req, res) {
  try {
    // Fetch all bets ordered by created_at desc
    const bets = await select('bets', 'order=created_at.desc');

    // Fetch all bet_results
    const betResults = await select('bet_results', '');

    // Build lookup by bet_id
    const resultsByBetId = {};
    for (const r of betResults) {
      resultsByBetId[r.bet_id] = r;
    }

    // Join
    const joined = bets.map(bet => {
      const result = resultsByBetId[bet.id] || null;
      return {
        id: bet.id,
        gameId: bet.game_id,
        teamBetOn: bet.team_bet_on,
        oddsAtBet: bet.odds_at_bet,
        impliedProbabilityAtBet: Number(bet.implied_probability_at_bet),
        modelDecisionAtBet: bet.model_decision_at_bet,
        edgeAtBet: Number(bet.edge_at_bet),
        stakeAmount: Number(bet.stake_amount),
        notes: bet.notes,
        createdAt: bet.created_at,
        result: result ? {
          closingOdds: result.closing_odds,
          closingImpliedProbability: Number(result.closing_implied_probability),
          clv: Number(result.clv),
          result: result.result,
          payoutAmount: result.payout_amount !== null ? Number(result.payout_amount) : null,
          clvCapturedAt: result.clv_captured_at,
        } : null,
      };
    });

    return res.status(200).json(joined);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── Task 1: POST /api/bets ─────────────────────────────────────────────────
async function handlePostBet(req, res) {
  try {
    const { gameId, teamBetOn, oddsAtBet, stakeAmount, notes } = req.body || {};

    // ── Validation ──
    if (!gameId) return res.status(400).json({ error: 'gameId is required' });
    if (!teamBetOn) return res.status(400).json({ error: 'teamBetOn is required' });
    if (oddsAtBet === undefined || oddsAtBet === null) return res.status(400).json({ error: 'oddsAtBet is required' });

    const odds = Number(oddsAtBet);
    if (!Number.isInteger(odds) || (odds > -100 && odds < 100)) {
      return res.status(400).json({ error: 'oddsAtBet must be a valid American odds integer (≤-100 or ≥+100)' });
    }

    if (!stakeAmount || Number(stakeAmount) <= 0) {
      return res.status(400).json({ error: 'stakeAmount must be a positive number' });
    }

    // Verify game exists and is scheduled
    const games = await select('games', `id=eq.${gameId}`);
    if (games.length === 0) {
      return res.status(404).json({ error: `Game not found: ${gameId}` });
    }
    const game = games[0];
    if (game.status !== 'scheduled') {
      return res.status(400).json({ error: `Cannot bet on a game with status '${game.status}'. Only 'scheduled' games are allowed.` });
    }

    // ── Calculate implied probability using M4 vig removal ──
    // For a single bet, we need the moneyline of the bet side.
    // impliedProbability gives raw implied prob (with vig).
    // For vig-removed probability, we need both sides of the line.
    // Fetch the current odds snapshot for vig removal context
    let oddsSnapshot = await select('odds_snapshots',
      `game_id=eq.${gameId}&snapshot_type=eq.current&order=captured_at.desc&limit=1`);
    if (oddsSnapshot.length === 0) {
      oddsSnapshot = await select('odds_snapshots',
        `game_id=eq.${gameId}&snapshot_type=eq.open&order=captured_at.desc&limit=1`);
    }

    // Calculate implied probability at bet from the actual odds entered
    // Per M5 spec: "Implied probability at bet must be calculated at the time of bet entry from the actual odds entered"
    // We use the bet odds + the other side from the snapshot for vig removal
    let impliedProbAtBet;
    if (oddsSnapshot.length > 0) {
      const snap = oddsSnapshot[0];
      const isHome = teamBetOn === game.home_team;
      const otherSideOdds = isHome ? Number(snap.away_moneyline) : Number(snap.home_moneyline);
      const vigResult = removeVig(
        isHome ? odds : otherSideOdds,
        isHome ? otherSideOdds : odds
      );
      impliedProbAtBet = isHome ? vigResult.homeTrueProb : vigResult.awayTrueProb;
    } else {
      // Fallback: raw implied probability (no vig removal possible without other side)
      impliedProbAtBet = impliedProbability(odds);
    }

    // ── Fetch model context ──
    const modelScores = await select('model_scores',
      `game_id=eq.${gameId}&evaluated_team=eq.${teamBetOn}&order=evaluated_at.desc&limit=1`);

    let modelDecisionAtBet = 'none';
    let edgeAtBet = 0;
    if (modelScores.length > 0) {
      modelDecisionAtBet = modelScores[0].decision;
      edgeAtBet = Number(modelScores[0].edge_percentage);
    }

    // ── Insert bet ──
    const betRow = {
      game_id: gameId,
      user_id: 'scott',
      team_bet_on: teamBetOn,
      odds_at_bet: odds,
      implied_probability_at_bet: parseFloat(impliedProbAtBet.toFixed(6)),
      model_decision_at_bet: modelDecisionAtBet,
      edge_at_bet: parseFloat(edgeAtBet.toFixed(6)),
      stake_amount: Number(stakeAmount),
      notes: notes || null,
    };

    const inserted = await insert('bets', betRow);

    return res.status(201).json({
      success: true,
      bet: {
        id: inserted[0].id,
        gameId: inserted[0].game_id,
        teamBetOn: inserted[0].team_bet_on,
        oddsAtBet: inserted[0].odds_at_bet,
        impliedProbabilityAtBet: Number(inserted[0].implied_probability_at_bet),
        modelDecisionAtBet: inserted[0].model_decision_at_bet,
        edgeAtBet: Number(inserted[0].edge_at_bet),
        stakeAmount: Number(inserted[0].stake_amount),
        notes: inserted[0].notes,
        createdAt: inserted[0].created_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
