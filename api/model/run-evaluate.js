// TEMPORARY: GET-accessible evaluate trigger (remove after use)
// GET /api/model/run-evaluate?date=YYYY-MM-DD
import { evaluateAllGames } from '../_lib/evaluateGame.js';

export default async function handler(req, res) {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date query parameter required in YYYY-MM-DD format' });
  }
  try {
    const { summary, results } = await evaluateAllGames(date, {});
    return res.status(200).json({ success: true, summary, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
