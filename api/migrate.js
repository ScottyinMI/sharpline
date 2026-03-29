// TEMPORARY ONE-SHOT MIGRATION — Remove after running
// Requires DATABASE_URL env var in Vercel (add via Vercel dashboard)
// Run: GET /api/migrate?token=sl_migrate_phase1

export default async function handler(req, res) {
  if (req.query.token !== 'sl_migrate_phase1') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Try Supabase service role approach first (REST DDL via pg_query function)
  const SUPABASE_URL = 'https://vfnnmfxvuuqpfrkvwftu.supabase.co';
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const DB_URL       = process.env.DATABASE_URL;

  if (!SERVICE_KEY && !DB_URL) {
    return res.status(500).json({
      error: 'Neither SUPABASE_SERVICE_KEY nor DATABASE_URL is set.',
      action: 'Add SUPABASE_SERVICE_KEY to Vercel environment variables, then re-run.',
      supabase_dashboard: 'https://app.supabase.com/project/vfnnmfxvuuqpfrkvwftu/settings/api',
      vercel_settings: 'https://vercel.com/scottyinmi/sharpline/settings/environment-variables',
    });
  }

  const statements = [
    // line_snapshots table
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
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_read_all') THEN CREATE POLICY "line_snapshots_read_all" ON line_snapshots FOR SELECT USING (true); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_insert_anon') THEN CREATE POLICY "line_snapshots_insert_anon" ON line_snapshots FOR INSERT WITH CHECK (true); END IF; END $$`,
    // engine_results table
    `CREATE TABLE IF NOT EXISTS engine_results (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id text NOT NULL,
      game_id text NOT NULL,
      sport text NOT NULL,
      market_type text NOT NULL,
      bet_side text NOT NULL,
      home_team text,
      away_team text,
      commence_time timestamptz,
      available_book text,
      available_odds integer,
      available_vig_removed numeric(6,5),
      consensus_prob numeric(6,5) NOT NULL,
      consensus_tier text NOT NULL,
      consensus_confidence numeric(4,3),
      sharp_books_used text[] DEFAULT '{}',
      raw_edge numeric(8,6),
      dampened_edge numeric(8,6) NOT NULL,
      dampening_factor numeric(4,3),
      min_threshold numeric(6,5),
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
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_select_own') THEN CREATE POLICY "engine_results_select_own" ON engine_results FOR SELECT USING (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $$`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_insert_own') THEN CREATE POLICY "engine_results_insert_own" ON engine_results FOR INSERT WITH CHECK (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $$`,
    // bets table - new columns
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS engine_result_id uuid REFERENCES engine_results(id) ON DELETE SET NULL`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS consensus_prob_at_track numeric(6,5)`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS score_at_track integer`,
    `ALTER TABLE bets ADD COLUMN IF NOT EXISTS verdict_at_track text`,
    `CREATE INDEX IF NOT EXISTS idx_bets_engine_result ON bets (engine_result_id) WHERE engine_result_id IS NOT NULL`,
  ];

  if (DB_URL) {
    // Use node-postgres if DATABASE_URL is available
    try {
      const { Client } = await import('pg');
      const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
      await client.connect();
      const results = [];
      for (const sql of statements) {
        try {
          await client.query(sql);
          results.push({ ok: true, sql: sql.slice(0, 60) });
        } catch (e) {
          results.push({ ok: false, sql: sql.slice(0, 60), error: e.message });
        }
      }
      await client.end();
      return res.status(200).json({ method: 'pg', results });
    } catch (e) {
      return res.status(500).json({ error: 'pg failed: ' + e.message });
    }
  }

  // Fallback: report that service key is present but we need pg for DDL
  return res.status(200).json({
    serviceKeyPresent: !!SERVICE_KEY,
    message: 'Service key found but DDL requires DATABASE_URL. Add DATABASE_URL to Vercel env vars.',
    supabase_db_settings: 'https://app.supabase.com/project/vfnnmfxvuuqpfrkvwftu/settings/database',
  });
}
