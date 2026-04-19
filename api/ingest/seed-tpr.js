// POST /api/ingest/seed-tpr
// Task 4: One-time seeding of team power ratings
// Accepts a JSON body with array of { team_id, rating_value, games_included, as_of_date }
// IDEMPOTENCY RULE: only inserts if no rating exists for that team_id on that date
// (This is append-only — never overwrites existing ratings)

import { select, insert } from '../_lib/supabase.js';

// Default seed data (Governance-provided values, 2026 preseason)
const DEFAULT_SEED = [
  { team_id: 'LAD', rating_value: 78.5, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'MIL', rating_value: 77.2, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'PHI', rating_value: 76.8, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'NYY', rating_value: 76.1, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'ATL', rating_value: 74.9, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'HOU', rating_value: 74.2, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'NYM', rating_value: 73.8, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'CHC', rating_value: 72.4, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'SEA', rating_value: 71.6, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'DET', rating_value: 71.1, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'BAL', rating_value: 70.3, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'SD',  rating_value: 69.8, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'CLE', rating_value: 69.2, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'TOR', rating_value: 68.7, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'BOS', rating_value: 67.9, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'SF',  rating_value: 67.4, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'MIN', rating_value: 66.8, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'TB',  rating_value: 66.1, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'STL', rating_value: 65.5, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'TEX', rating_value: 64.9, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'ARI', rating_value: 64.2, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'KC',  rating_value: 63.7, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'PIT', rating_value: 63.1, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'CIN', rating_value: 62.4, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'MIA', rating_value: 60.8, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'WSH', rating_value: 60.1, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'OAK', rating_value: 59.4, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'LAA', rating_value: 58.7, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'CHW', rating_value: 57.2, games_included: 0, as_of_date: '2026-04-18' },
  { team_id: 'COL', rating_value: 54.8, games_included: 0, as_of_date: '2026-04-18' },
];

export async function seedTeamPowerRatings(seedData = DEFAULT_SEED) {
  const log = { inserted: 0, skipped: 0, errors: [] };

  for (const row of seedData) {
    // Check if this team already has a rating on this date
    try {
      const existing = await select(
        'team_power_ratings',
        `team_id=eq.${row.team_id}&as_of_date=eq.${row.as_of_date}&limit=1`
      );
      if (existing.length > 0) {
        console.log(`[SEED-TPR] Skipping ${row.team_id} — rating already exists for ${row.as_of_date}`);
        log.skipped++;
        continue;
      }
    } catch (err) {
      log.errors.push(`Check failed for ${row.team_id}: ${err.message}`);
      continue;
    }

    // Insert the seed row
    try {
      await insert('team_power_ratings', {
        team_id: row.team_id,
        rating_value: row.rating_value,
        previous_rating_value: null,
        game_performance_score: null,
        games_included: row.games_included || 0,
        as_of_date: row.as_of_date,
      });
      log.inserted++;
      console.log(`[SEED-TPR] Inserted ${row.team_id}: ${row.rating_value}`);
    } catch (err) {
      log.errors.push(`Insert failed for ${row.team_id}: ${err.message}`);
    }
  }

  console.log(`[SEED-TPR] Done: ${log.inserted} inserted, ${log.skipped} skipped`);
  return log;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const summary = { success: true, updated: 0, skipped: 0, errors: [] };

  try {
    // Allow custom seed data via request body, otherwise use defaults
    let seedData = DEFAULT_SEED;
    if (req.body && Array.isArray(req.body)) {
      seedData = req.body;
    }

    const result = await seedTeamPowerRatings(seedData);
    summary.updated = result.inserted;
    summary.skipped = result.skipped;
    summary.errors = result.errors;
    summary.success = result.errors.length === 0 || result.inserted > 0;
  } catch (err) {
    summary.success = false;
    summary.errors.push(err.message);
  }

  return res.status(summary.success ? 200 : 500).json(summary);
}
