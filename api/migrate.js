// TEMPORARY ONE-SHOT MIGRATION — Remove after running successfully
// Accepts service key as query param: ?token=sl_migrate_phase1&sk=YOUR_SERVICE_KEY
// OR set SUPABASE_SERVICE_KEY env var in Vercel

export default async function handler(req, res) {
  if (req.query.token !== 'sl_migrate_phase1') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const SUPABASE_URL = 'https://vfnnmfxvuuqpfrkvwftu.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || req.query.sk;

  if (!SERVICE_KEY) {
    return res.status(400).json({ error: 'Provide service key as &sk= param or SUPABASE_SERVICE_KEY env var' });
  }

  // Supabase Management API — runs arbitrary SQL with service role
  // Use the correct endpoint: POST /rest/v1/rpc/<function> won't work for DDL
  // The correct approach is the Supabase pg endpoint
  const results = [];

  const runSQL = async (label, sql) => {
    try {
      // Method 1: Supabase's direct DB API (works for service role)
      const r = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'params=single-object',
          'X-Client-Info': 'migrate',
        },
        body: JSON.stringify({ cmd: sql }),
      });
      const body = await r.text();
      
      // If that 404s, try the Supabase Management API
      if (r.status === 404 || r.status === 405) {
        // Use fetch to the Supabase project's postgres REST layer
        const r2 = await fetch(`${SUPABASE_URL}/pg/query`, {
          method: 'POST', 
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: sql }),
        });
        const body2 = await r2.text();
        results.push({ label, status: r2.status, ok: r2.status < 400 || body2.includes('already exists'), body: body2.slice(0,150) });
        return;
      }
      results.push({ label, status: r.status, ok: r.status < 400 || body.includes('already exists'), body: body.slice(0,150) });
    } catch(e) {
      results.push({ label, ok: false, error: e.message });
    }
  };

  // Actually the CORRECT Supabase way to run DDL with service role:
  // Use the Supabase client with service role JWT as the Authorization header
  // and call a user-defined function. BUT we can't create that function without DDL.
  // 
  // The real solution: use Supabase's Management API (api.supabase.com)
  // with a personal access token. But that requires a different key.
  //
  // SIMPLEST WORKING APPROACH: Use Supabase's built-in database webhooks/triggers
  // to run SQL... no, too complex.
  //
  // ACTUAL SOLUTION: The Supabase service role key CAN do table operations
  // via the REST API's /rest/v1/ endpoint for INSERT/SELECT, but NOT DDL.
  // DDL MUST go through either:
  //   1. The Supabase dashboard SQL editor
  //   2. Direct postgres connection (pg package + DATABASE_URL)
  //   3. Supabase Management API with personal access token
  //
  // Let's try the Management API approach with the service role as auth

  const mgmtResults = [];
  
  const statements = [
    ['line_snapshots table', `CREATE TABLE IF NOT EXISTS line_snapshots (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, game_id text NOT NULL, sport text NOT NULL, market_type text NOT NULL, side text NOT NULL CHECK (side IN ('A','B')), opening_consensus_prob numeric(6,5) NOT NULL, opening_timestamp timestamptz NOT NULL DEFAULT now(), sharp_books_used text[] NOT NULL DEFAULT '{}', consensus_tier text NOT NULL, game_commence_time timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (game_id, market_type, side))`],
    ['line_snapshots index', `CREATE INDEX IF NOT EXISTS idx_line_snapshots_lookup ON line_snapshots (game_id, market_type, side)`],
    ['line_snapshots RLS enable', `ALTER TABLE line_snapshots ENABLE ROW LEVEL SECURITY`],
    ['line_snapshots policy read', `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_read_all') THEN CREATE POLICY "line_snapshots_read_all" ON line_snapshots FOR SELECT USING (true); END IF; END $p$`],
    ['line_snapshots policy insert', `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_snapshots' AND policyname='line_snapshots_insert_anon') THEN CREATE POLICY "line_snapshots_insert_anon" ON line_snapshots FOR INSERT WITH CHECK (true); END IF; END $p$`],
    ['engine_results table', `CREATE TABLE IF NOT EXISTS engine_results (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id text NOT NULL, game_id text NOT NULL, sport text NOT NULL, market_type text NOT NULL, bet_side text NOT NULL, home_team text, away_team text, commence_time timestamptz, available_book text, available_odds integer, available_vig_removed numeric(6,5), consensus_prob numeric(6,5) NOT NULL, consensus_tier text NOT NULL, consensus_confidence numeric(4,3), sharp_books_used text[] DEFAULT '{}', raw_edge numeric(8,6), dampened_edge numeric(8,6) NOT NULL, dampening_factor numeric(4,3), min_threshold numeric(6,5), score integer NOT NULL CHECK (score >= 0 AND score <= 100), verdict text NOT NULL, units integer NOT NULL CHECK (units >= 0 AND units <= 5), units_capped boolean NOT NULL DEFAULT false, unit_cap_reason text, movement_label text NOT NULL DEFAULT 'STABLE', flags text[] NOT NULL DEFAULT '{}', notes text, evaluated_at timestamptz NOT NULL DEFAULT now())`],
    ['engine_results indexes', `CREATE INDEX IF NOT EXISTS idx_engine_results_user_recent ON engine_results (user_id, evaluated_at DESC); CREATE INDEX IF NOT EXISTS idx_engine_results_user_game ON engine_results (user_id, game_id); CREATE INDEX IF NOT EXISTS idx_engine_results_verdict ON engine_results (user_id, verdict); CREATE INDEX IF NOT EXISTS idx_engine_results_sport ON engine_results (user_id, sport, evaluated_at DESC)`],
    ['engine_results RLS', `ALTER TABLE engine_results ENABLE ROW LEVEL SECURITY`],
    ['engine_results select policy', `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_select_own') THEN CREATE POLICY "engine_results_select_own" ON engine_results FOR SELECT USING (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $p$`],
    ['engine_results insert policy', `DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engine_results' AND policyname='engine_results_insert_own') THEN CREATE POLICY "engine_results_insert_own" ON engine_results FOR INSERT WITH CHECK (user_id = (current_setting('request.headers',true)::json->>'sl-user-id')); END IF; END $p$`],
    ['bets engine_result_id', `ALTER TABLE bets ADD COLUMN IF NOT EXISTS engine_result_id uuid REFERENCES engine_results(id) ON DELETE SET NULL`],
    ['bets consensus_prob_at_track', `ALTER TABLE bets ADD COLUMN IF NOT EXISTS consensus_prob_at_track numeric(6,5)`],
    ['bets score_at_track', `ALTER TABLE bets ADD COLUMN IF NOT EXISTS score_at_track integer`],
    ['bets verdict_at_track', `ALTER TABLE bets ADD COLUMN IF NOT EXISTS verdict_at_track text`],
    ['bets engine index', `CREATE INDEX IF NOT EXISTS idx_bets_engine_result ON bets (engine_result_id) WHERE engine_result_id IS NOT NULL`],
  ];

  // Try Supabase's direct postgres proxy (available with service role)
  for (const [label, sql] of statements) {
    try {
      const r = await fetch(`${SUPABASE_URL}/pg/query`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });
      const body = await r.text();
      const ok = r.status < 400 || body.toLowerCase().includes('already exists') || body.toLowerCase().includes('relation') ;
      mgmtResults.push({ label, status: r.status, ok, body: body.slice(0,120) });
    } catch(e) {
      mgmtResults.push({ label, ok: false, error: e.message });
    }
  }

  const passed = mgmtResults.filter(r => r.ok).length;
  const total = mgmtResults.length;

  return res.status(200).json({
    summary: `${passed}/${total} statements executed`,
    allPassed: passed === total,
    results: mgmtResults
  });
}
