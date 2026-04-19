// POST /api/model/evaluate?date=YYYY-MM-DD
// M4 Task 10: Manual trigger endpoint for model evaluation
// Evaluates both teams for all scheduled games on a given date

import { evaluateGame, evaluateAllGames } from '../_lib/evaluateGame.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { date, gameId, team } = req.query;

  try {
    // Single game evaluation mode
    if (gameId && team) {
      const manualInputs = req.body || {};
      const result = await evaluateGame(gameId, team, manualInputs);
      return res.status(200).json({ success: true, result });
    }

    // Full date evaluation mode
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query parameter required in YYYY-MM-DD format' });
    }

    const bulkManualInputs = req.body || {};
    const { summary, results } = await evaluateAllGames(date, bulkManualInputs);

    return res.status(200).json({
      success: summary.errors.length === 0 || summary.evaluations > 0,
      summary,
      results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
