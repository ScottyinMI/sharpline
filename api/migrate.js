// TEMPORARY ONE-SHOT MIGRATION — Remove after running
// Usage: GET /api/migrate?token=sl_migrate_phase1&sk=YOUR_SERVICE_KEY
// OR: Set SUPABASE_SERVICE_KEY in Vercel env vars, then GET /api/migrate?token=sl_migrate_phase1
// Remove this file after successful migration.

export default async function handler(req, res) {
  if (req.query.token !== 'sl_migrate_phase1') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const SUPABASE_URL = 'https://vfnnmfxvuuqpfrkvwftu.supabase.co';
  // Accept service key from env var OR from query param (for one-time use)
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || req.query.sk;

  if (!SERVICE_KEY) {
    return res.status(400).json({
      error: 'Service key required.',
      options: [
        '1. Add SUPABASE_SERVICE_KEY to Vercel env vars and redeploy, then call this endpoint',
        '2. Call this endpoint with &sk=YOUR_SERVICE_KEY appended to the URL',
        'Get your service key at: https://app.supabase.com/project/vfnnmfxvuuqpfrkvwftu/settings/api',
      ]
    });
  }

  // Run each DDL statement via Supabase's direct SQL endpoint
  const statements = [
    `CREATE TABLE IF NOT EXISTS line_snapshots (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      game_id text NOT NULL,
      sport text NOT NULL,
      market_type text NOT NULL,
      side text NOT NULL CHECK (side IN ('A','B')),
      opening_consensus_prob numeric(6,5) NOT NULL,
      opening_timestamp timestamptz NOT NULL DEFAULT now(),
      sharp_books_used text[] NOT NULL DEFAULT '{}',
      consensus_tier text NOT NULL,
      game_commence_time timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (game_id, market_type, side)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_line_snapshots_lookup ON line_snapshots (game_id, market_type, side)`,
    `ALTER TABLE line_snapshots ENABLE ROW LEVEL SECURITY`,
    `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_read_all') THEN CREATE POLICY "line_snapshots_read_all" ON line_snapshots FOR SELECT USING (true); END IF; END $p$`,
    `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_insert_anon') THEN CREATE POLICY "line_snapshots_insert_anon" ON line_snapshots FOR INSERT WITH CHECK (true); END IF; END $p$`,
    `CREATE TABLE IF NOT EXISTS engine_results (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id text NOT NULL,
      game_id text NOT NULL,
      sport text NOT NULL,
      market_type text NOT NULL,
      bet_side text NOT NULL,
      home_team text, away_team text, commence_time timestamptz,
      available_book text, available_odds integer, available_vig_removed numeric(6,5),
      consensus_prob numeric(6,5) NOT NULL,
      consensus_tier text NOT NULL,
      consensus_confidence numeric(4,3),
      sharp_books_used text[] DEFAULT '{}',
      raw_edge numeric(8,6), dampened_edge numeric(8,6) NOT NULL,
      dampening_factor numeric(4,3), min_threshold numeric(6,5),
      score integer NOT NULL CHECK (score >= 0 AND score <= 100),
      verdict text NOT NULL,
      units integer NOT NULL CHECK (units >= 0 AND units <= 5),
      units_capped boolean NOT NULL DEFAULT false,
      unit_cap_reason text,
      movement_label text NOT NULL DEFAULT 'STABLE',
      flags text[] NOT NULL DEFAULT '{}',
      notes text,
      evaluated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_engine_results_user_recent ON engine_results (user_id, evaluated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_engine_results_user_game ON engine_results (user_id, game_id)`,
    `CREATE INDEX IF NOT EXISTS idx_engine_results_verdict ON engine_results (user_id, verdict)`,
    `CREATE INDEX IF NOT EXISTS idx_engine_results_sport ON engine_results (user_id, sport, evaluated_at DESC)`,
    `ALTER TABLE engine_results ENABLE ROW LEVEL SECURITY`,
    `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_select_own') THEN CREATE POLICY "engine_results_select_own" ON engine_results FOR SELECT USING (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $p$`,
    `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_insert_own') THEN CREATE POLICY "engine_results_insert_own" ON engine_results FOR INSERT WITH CHECK (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $p$`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS engine_result_id uuid REFERENCES engine_results(id) ON DELETE SET NULL`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS consensus_prob_at_track numeric(6,5)`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS score_at_track integer`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS verdict_at_track text`,
    `CREATE INDEX IF NOT EXISTS idx_bets_engine_result ON bets (engine_result_id) WHERE engine_result_id IS NOT NULL`,
  ];

  const results = [];
  for (const sql of statements) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      });
      const body = await r.text();
      results.push({ ok: r.ok || body.includes('already exists'), sql: sql.slice(0, 80), status: r.status, body: body.slice(0, 100) });
    } catch(e) {
      results.push({ ok: false, sql: sql.slice(0, 80), error: e.message });
    }
  }

  // Also try the direct /sql endpoint (newer Supabase)
  if (results.every(r => !r.ok)) {
    try {
      const allSql = statements.join(';\n');
      const r = await fetch(`${SUPABASE_URL}/sql`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: allSql }),
      });
      const body = await r.text();
      return res.json({ method: 'direct_sql', status: r.status, body: body.slice(0, 500) });
    } catch(e) {
      // Fall through
    }
  }

  return res.json({ results, allPassed: results.filter(r=>r.ok).length + '/' + results.length });
}
