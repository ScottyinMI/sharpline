// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/bets/discipline — Discipline Score (M6 Task 5)
//
// Discipline Score = % of model-recommended Bet/Lean games where a bet was placed.
//
// Formula:
//   numerator   = distinct games where (1) model decision was Bet or Lean AND
//                 (2) a bet was actually logged for that game
//   denominator = distinct games where the latest model decision for any team
//                 was Bet or Lean (regardless of whether a bet was placed)
//
// Returns: { betLeanGames, betsPlacedOnBetLean, disciplineScore }
// ═══════════════════════════════════════════════════════════════════════════════

import { select } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed — use GET' });
  }

  try {
    // Fetch all model_scores ordered by evaluated_at desc
    const allScores = await select('model_scores', 'order=evaluated_at.desc');

    if (!allScores.length) {
      return res.status(200).json({
        betLeanGames: 0,
        betsPlacedOnBetLean: 0,
        disciplineScore: null,
        note: 'No model evaluations found',
      });
    }

    // Build map: game_id -> latest decision per game (take highest-edge Bet/Lean, or first)
    // A game counts as Bet/Lean if ANY team's latest evaluation is Bet or Lean.
    const latestByGameTeam = new Map();
    for (const score of allScores) {
      const key = `${score.game_id}:${score.evaluated_team}`;
      if (!latestByGameTeam.has(key)) {
        latestByGameTeam.set(key, score);
      }
    }

    // Collect unique game IDs where any team has Bet or Lean
    const betLeanGameIds = new Set();
    for (const score of latestByGameTeam.values()) {
      if (score.decision === 'bet' || score.decision === 'lean') {
        betLeanGameIds.add(score.game_id);
      }
    }

    const denominator = betLeanGameIds.size;

    if (denominator === 0) {
      return res.status(200).json({
        betLeanGames: 0,
        betsPlacedOnBetLean: 0,
        disciplineScore: null,
        note: 'No Bet or Lean evaluations found',
      });
    }

    // Fetch all bets
    const bets = await select('bets', 'order=created_at.desc');

    // Count distinct Bet/Lean game IDs that have at least one bet
    const bettedOnBetLean = new Set(
      bets.filter(b => betLeanGameIds.has(b.game_id)).map(b => b.game_id)
    );
    const numerator = bettedOnBetLean.size;

    const disciplineScore = parseFloat(((numerator / denominator) * 100).toFixed(2));

    return res.status(200).json({
      betLeanGames: denominator,
      betsPlacedOnBetLean: numerator,
      disciplineScore,
      note: `${numerator} of ${denominator} Bet/Lean games had a bet placed`,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
