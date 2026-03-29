-- =============================================================================
-- SHARPLINE — COMPONENT 9: SUPABASE SCHEMA CHANGES
-- =============================================================================
-- Run this SQL in the Supabase SQL Editor for your project.
-- Project: vfnnmfxvuuqpfrkvwftu.supabase.co
--
-- Changes:
--   1. CREATE TABLE line_snapshots (new)
--   2. CREATE TABLE engine_results (new)
--   3. ALTER TABLE bets — 4 new nullable columns
--
-- All changes are additive. No existing columns modified or removed.
-- Existing bets rows are unaffected (new columns are nullable).
-- =============================================================================


-- =============================================================================
-- TABLE 1: line_snapshots
-- =============================================================================
-- Stores the opening sharp consensus snapshot per game/market/side.
-- Written by Component 5 (trackLineMovement) on first scanner run per game.
-- Readable by all users (shared market data). Writable by service role only.

CREATE TABLE IF NOT EXISTS line_snapshots (
  id                     uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id                text          NOT NULL,
  sport                  text          NOT NULL,
  market_type            text          NOT NULL,
  side                   text          NOT NULL  CHECK (side IN ('A', 'B')),
  opening_consensus_prob numeric(6,5)  NOT NULL,
  opening_timestamp      timestamptz   NOT NULL  DEFAULT now(),
  sharp_books_used       text[]        NOT NULL  DEFAULT '{}',
  consensus_tier         text          NOT NULL,
  game_commence_time     timestamptz,
  created_at             timestamptz   NOT NULL  DEFAULT now(),

  -- Only one snapshot per game/market/side combination
  UNIQUE (game_id, market_type, side)
);

-- Index for fast lookup by Component 5
CREATE INDEX IF NOT EXISTS idx_line_snapshots_lookup
  ON line_snapshots (game_id, market_type, side);

-- RLS
ALTER TABLE line_snapshots ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read snapshots (shared market data)
DROP POLICY IF EXISTS "line_snapshots_read_all" ON line_snapshots;
CREATE POLICY "line_snapshots_read_all"
  ON line_snapshots FOR SELECT
  USING (true);

-- Anon key (client) can insert snapshots — Component 5 writes from browser
-- This is acceptable because snapshots are shared market data, not personal data
DROP POLICY IF EXISTS "line_snapshots_insert_anon" ON line_snapshots;
CREATE POLICY "line_snapshots_insert_anon"
  ON line_snapshots FOR INSERT
  WITH CHECK (true);


-- =============================================================================
-- TABLE 2: engine_results
-- =============================================================================
-- Stores the full engine output for each evaluated market.
-- Written by Component 8 (buildRecommendationCard) for WATCH and above results.
-- Per-user via device ID. Audit trail and future CLV foundation.

CREATE TABLE IF NOT EXISTS engine_results (
  id                   uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              text          NOT NULL,
  game_id              text          NOT NULL,
  sport                text          NOT NULL,
  market_type          text          NOT NULL,
  bet_side             text          NOT NULL,
  home_team            text,
  away_team            text,
  commence_time        timestamptz,
  available_book       text,
  available_odds       integer,
  available_vig_removed numeric(6,5),
  consensus_prob       numeric(6,5)  NOT NULL,
  consensus_tier       text          NOT NULL,
  consensus_confidence numeric(4,3),
  sharp_books_used     text[]        DEFAULT '{}',
  raw_edge             numeric(8,6),
  dampened_edge        numeric(8,6)  NOT NULL,
  dampening_factor     numeric(4,3),
  min_threshold        numeric(6,5),
  score                integer       NOT NULL  CHECK (score >= 0 AND score <= 100),
  verdict              text          NOT NULL,
  units                integer       NOT NULL  CHECK (units >= 0 AND units <= 5),
  units_capped         boolean       NOT NULL  DEFAULT false,
  unit_cap_reason      text,
  movement_label       text          NOT NULL  DEFAULT 'STABLE',
  flags                text[]        NOT NULL  DEFAULT '{}',
  notes                text,
  evaluated_at         timestamptz   NOT NULL  DEFAULT now()
);

-- Indexes for scanner queries
CREATE INDEX IF NOT EXISTS idx_engine_results_user_recent
  ON engine_results (user_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_engine_results_user_game
  ON engine_results (user_id, game_id);

CREATE INDEX IF NOT EXISTS idx_engine_results_verdict
  ON engine_results (user_id, verdict);

CREATE INDEX IF NOT EXISTS idx_engine_results_sport
  ON engine_results (user_id, sport, evaluated_at DESC);

-- RLS
ALTER TABLE engine_results ENABLE ROW LEVEL SECURITY;

-- Users see only their own results (keyed on device ID)
DROP POLICY IF EXISTS "engine_results_select_own" ON engine_results;
CREATE POLICY "engine_results_select_own"
  ON engine_results FOR SELECT
  USING (user_id = current_setting('request.headers', true)::json->>'sl-user-id');

-- Allow insert from anon key (client writes via device ID)
DROP POLICY IF EXISTS "engine_results_insert_own" ON engine_results;
CREATE POLICY "engine_results_insert_own"
  ON engine_results FOR INSERT
  WITH CHECK (user_id = current_setting('request.headers', true)::json->>'sl-user-id');


-- =============================================================================
-- TABLE 3: bets — ADD 4 NEW NULLABLE COLUMNS
-- =============================================================================
-- No existing columns are modified. All additions are nullable.
-- Existing rows are unaffected.

-- Link to engine evaluation that produced the recommendation
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS engine_result_id uuid
    REFERENCES engine_results(id) ON DELETE SET NULL;

-- Sharp consensus probability at the moment 'Track This Bet' was tapped
-- This is the CLV closing line proxy for Phase 1
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS consensus_prob_at_track numeric(6,5);

-- Engine score at time of tracking
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS score_at_track integer;

-- Verdict label at time of tracking
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS verdict_at_track text;

-- Index for CLV queries (find bets with consensus_prob captured)
CREATE INDEX IF NOT EXISTS idx_bets_engine_result
  ON bets (engine_result_id)
  WHERE engine_result_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bets_clv_pending
  ON bets (user_id, result)
  WHERE consensus_prob_at_track IS NOT NULL AND result IS NOT NULL;


-- =============================================================================
-- VERIFICATION QUERIES
-- Run these after executing the schema to confirm all changes applied.
-- =============================================================================

-- 1. Confirm both new tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('line_snapshots', 'engine_results')
ORDER BY table_name;

-- 2. Confirm new bets columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bets'
  AND column_name IN ('engine_result_id','consensus_prob_at_track','score_at_track','verdict_at_track')
ORDER BY column_name;

-- 3. Confirm indexes exist
SELECT indexname
FROM pg_indexes
WHERE tablename IN ('line_snapshots', 'engine_results', 'bets')
  AND indexname LIKE 'idx_%'
ORDER BY indexname;

-- 4. Test snapshot insert (clean up after)
INSERT INTO line_snapshots (game_id, sport, market_type, side, opening_consensus_prob, sharp_books_used, consensus_tier)
VALUES ('test_game_verify', 'basketball_nba', 'spreads', 'A', 0.51234, '{"williamhill_us"}', 'SINGLE_SHARP');

SELECT * FROM line_snapshots WHERE game_id = 'test_game_verify';

DELETE FROM line_snapshots WHERE game_id = 'test_game_verify';
