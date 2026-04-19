// ═══════════════════════════════════════════════════════════════════════════════
// SHARPLINE — evaluateGame orchestrator (M4 Task 9)
// Runs the full 13-step model pipeline for one team in one game.
// All DB reads happen here — scoring functions are pure.
// ═══════════════════════════════════════════════════════════════════════════════

import { select, insert } from './supabase.js';
import {
  removeVig,
  pitcherQualityScore,
  scorePitcherAdvantage,
  scoreTeamForm,
  scoreLineMovement,
  scorePublicSplits,
  scoreInjuryImpact,
  scoreWeather,
  scoreRestSchedule,
  applyDecisionRules,
  TOTAL_ADJ_CAP,
  PROB_FLOOR,
  PROB_CEILING,
  PITCHER_GATE_THRESHOLD,
} from './model.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — data fetching from Supabase REST API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGame(gameId) {
  const rows = await select('games', `id=eq.${gameId}`);
  return rows[0] || null;
}

async function fetchOddsSnapshot(gameId) {
  // Prefer 'current', fall back to 'open'
  let rows = await select('odds_snapshots',
    `game_id=eq.${gameId}&snapshot_type=eq.current&order=captured_at.desc&limit=1`);
  if (rows.length === 0) {
    rows = await select('odds_snapshots',
      `game_id=eq.${gameId}&snapshot_type=eq.open&order=captured_at.desc&limit=1`);
  }
  return rows[0] || null;
}

async function fetchOpenOddsSnapshot(gameId) {
  const rows = await select('odds_snapshots',
    `game_id=eq.${gameId}&snapshot_type=eq.open&order=captured_at.desc&limit=1`);
  return rows[0] || null;
}

async function fetchPitcherStatsByName(pitcherName) {
  if (!pitcherName) return null;
  const encoded = encodeURIComponent(pitcherName);
  const rows = await select('pitcher_stats', `pitcher_name=eq.${encoded}&order=season.desc&limit=1`);
  return rows[0] || null;
}

async function fetchPitcherRecentForm(pitcherId) {
  if (!pitcherId) return [];
  const rows = await select('pitcher_recent_form',
    `pitcher_id=eq.${pitcherId}&order=game_date.desc&limit=5`);
  return rows;
}

async function fetchTPR(teamId) {
  if (!teamId) return null;
  const rows = await select('team_power_ratings',
    `team_id=eq.${teamId}&order=as_of_date.desc&limit=1`);
  return rows[0] || null;
}

async function fetchLast10TPRs(teamId) {
  if (!teamId) return [];
  const rows = await select('team_power_ratings',
    `team_id=eq.${teamId}&order=as_of_date.desc&limit=10`);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 9: evaluateGame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} gameId - UUID from games table
 * @param {string} evaluatedTeam - 3-letter team abbreviation (e.g. 'NYY')
 * @param {object} manualInputs - optional { publicBetPct, injuryInputs, weatherInput, restInput }
 * @returns {object} full evaluation result
 */
export async function evaluateGame(gameId, evaluatedTeam, manualInputs = {}) {
  const warnings = [];

  // ── Step 1: Fetch game record ──
  const game = await fetchGame(gameId);
  if (!game) throw new Error(`Game not found: ${gameId}`);

  const isHome = evaluatedTeam === game.home_team;
  const opponentTeam = isHome ? game.away_team : game.home_team;
  const evalPitcherName = isHome ? game.home_pitcher : game.away_pitcher;
  const oppPitcherName = isHome ? game.away_pitcher : game.home_pitcher;
  const evalVenueType = isHome ? 'home' : 'away';
  const oppVenueType = isHome ? 'away' : 'home';

  // ── Step 2: Fetch odds snapshot ──
  const odds = await fetchOddsSnapshot(gameId);
  if (!odds) throw new Error(`No odds snapshot found for game: ${gameId}`);

  const homeML = Number(odds.home_moneyline);
  const awayML = Number(odds.away_moneyline);

  // ── Step 3: Vig removal → market probability ──
  const { homeTrueProb, awayTrueProb } = removeVig(homeML, awayML);
  const marketProbability = isHome ? homeTrueProb : awayTrueProb;

  // ── Step 4: Score all 7 factors ──

  // Factor 1: Pitcher Advantage
  const evalPitcherStats = await fetchPitcherStatsByName(evalPitcherName);
  const oppPitcherStats = await fetchPitcherStatsByName(oppPitcherName);
  if (!evalPitcherStats && evalPitcherName) warnings.push(`No pitcher stats for ${evalPitcherName} — defaulting to neutral (5.0)`);
  if (!oppPitcherStats && oppPitcherName) warnings.push(`No pitcher stats for ${oppPitcherName} — defaulting to neutral (5.0)`);
  if (!evalPitcherName) warnings.push(`No pitcher listed for ${evaluatedTeam} — defaulting to neutral (5.0)`);
  if (!oppPitcherName) warnings.push(`No pitcher listed for ${opponentTeam} — defaulting to neutral (5.0)`);

  const evalRecentForm = evalPitcherStats ? await fetchPitcherRecentForm(evalPitcherStats.pitcher_id) : [];
  const oppRecentForm = oppPitcherStats ? await fetchPitcherRecentForm(oppPitcherStats.pitcher_id) : [];

  const evalPQS = pitcherQualityScore(evalPitcherStats, evalRecentForm, evalVenueType);
  const oppPQS = pitcherQualityScore(oppPitcherStats, oppRecentForm, oppVenueType);
  const pitcher = scorePitcherAdvantage(evalPQS, oppPQS);

  // Factor 2: Team Form
  const evalTPRRow = await fetchTPR(evaluatedTeam);
  const oppTPRRow = await fetchTPR(opponentTeam);
  if (!evalTPRRow) warnings.push(`No TPR for ${evaluatedTeam} — defaulting to neutral`);
  if (!oppTPRRow) warnings.push(`No TPR for ${opponentTeam} — defaulting to neutral`);

  const evalTPR = evalTPRRow ? Number(evalTPRRow.rating_value) : null;
  const oppTPR = oppTPRRow ? Number(oppTPRRow.rating_value) : null;

  // Recency: count wins in last 10 TPR updates (games_included increases = game played)
  let recencyData = null;
  if (evalTPR !== null && oppTPR !== null) {
    const evalLast10 = await fetchLast10TPRs(evaluatedTeam);
    const oppLast10 = await fetchLast10TPRs(opponentTeam);
    // Approximate wins: count entries where rating went up (game_performance_score > previous rating)
    const countWins = (tprRows) => {
      let wins = 0;
      for (const row of tprRows) {
        if (row.game_performance_score !== null && row.previous_rating_value !== null) {
          if (Number(row.game_performance_score) > Number(row.previous_rating_value)) wins++;
        }
      }
      return wins;
    };
    recencyData = {
      evalLast10Wins: evalLast10.length > 0 ? countWins(evalLast10) : null,
      oppLast10Wins: oppLast10.length > 0 ? countWins(oppLast10) : null,
    };
  }
  const teamForm = scoreTeamForm(evalTPR, oppTPR, recencyData);

  // Factor 3: Line Movement
  const openOdds = await fetchOpenOddsSnapshot(gameId);
  let movementPct = null;
  let timingCategory = 'day_of';
  if (openOdds && odds) {
    const openProb = isHome ? Number(openOdds.home_implied_prob) : Number(openOdds.away_implied_prob);
    const currentProb = isHome ? Number(odds.home_implied_prob) : Number(odds.away_implied_prob);
    movementPct = (currentProb - openProb) * 100; // convert decimal to percentage points

    // Determine timing: compare captured_at to game date
    const capturedAt = new Date(odds.captured_at);
    const gameDate = new Date(game.date + 'T00:00:00');
    const hoursBeforeGame = (gameDate.getTime() - capturedAt.getTime()) / (1000 * 60 * 60);
    if (hoursBeforeGame > 24) timingCategory = 'before_gameday';
    else if (hoursBeforeGame < 3) timingCategory = 'close_to_gametime';
    else timingCategory = 'day_of';
  } else {
    if (!openOdds) warnings.push('No opening odds snapshot — line movement defaulting to 0');
  }
  const lineMove = scoreLineMovement(movementPct, timingCategory);

  // Factor 4: Public Splits (manual input)
  const publicBetPct = manualInputs.publicBetPct ?? 50;
  const publicSplits = scorePublicSplits(publicBetPct, lineMove.score);

  // Factor 5: Injury Impact (manual input)
  const injury = scoreInjuryImpact(manualInputs.injuryInputs || null);

  // Factor 6: Weather (manual input)
  const weather = scoreWeather(manualInputs.weatherInput || null, evalPQS, oppPQS);

  // Factor 7: Rest/Schedule (manual input)
  const rest = scoreRestSchedule(manualInputs.restInput || null);

  // ── Step 5-6: Calculate adjustments and total ──
  let totalAdjustment =
    pitcher.adjustment +
    teamForm.adjustment +
    lineMove.adjustment +
    publicSplits.adjustment +
    injury.adjustment +
    weather.adjustment +
    rest.adjustment;

  // ── Step 7: Cap total adjustment at ±15 ──
  const uncappedTotal = totalAdjustment;
  totalAdjustment = Math.max(-TOTAL_ADJ_CAP, Math.min(TOTAL_ADJ_CAP, totalAdjustment));

  // ── Step 8: Model probability ──
  let modelProbability = marketProbability + (totalAdjustment / 100);

  // ── Step 9: Cap model probability ──
  modelProbability = Math.max(PROB_FLOOR, Math.min(PROB_CEILING, modelProbability));

  // ── Step 10: Edge percentage ──
  const edgePercentage = (modelProbability - marketProbability) * 100;

  // ── Step 11: Pitcher gate ──
  const pitcherGatePassed = Math.abs(pitcher.score) >= PITCHER_GATE_THRESHOLD;

  // ── Step 12: Decision rules ──
  const decision = applyDecisionRules(edgePercentage, pitcherGatePassed);

  // ── Step 13: Write to model_scores table ──
  const resultRow = {
    game_id: gameId,
    evaluated_team: evaluatedTeam,
    market_probability: round6(marketProbability),
    pitcher_advantage_score: pitcher.score,
    team_form_score: teamForm.score,
    line_movement_score: lineMove.score,
    public_splits_score: publicSplits.score,
    injury_impact_score: injury.score,
    weather_score: weather.score,
    rest_schedule_score: rest.score,
    pitcher_adjustment: pitcher.adjustment,
    team_form_adjustment: teamForm.adjustment,
    line_movement_adjustment: lineMove.adjustment,
    public_splits_adjustment: publicSplits.adjustment,
    injury_adjustment: injury.adjustment,
    weather_adjustment: weather.adjustment,
    rest_adjustment: rest.adjustment,
    total_adjustment: round6(totalAdjustment),
    model_probability: round6(modelProbability),
    edge_percentage: round6(edgePercentage),
    pitcher_gate_passed: pitcherGatePassed,
    decision: decision,
    evaluated_at: new Date().toISOString(),
  };

  await insert('model_scores', resultRow);

  // ── Step 14: Return full result ──
  return {
    gameId,
    evaluatedTeam,
    opponentTeam,
    isHome,
    game: { date: game.date, homeTeam: game.home_team, awayTeam: game.away_team, venue: game.venue },
    odds: { homeML, awayML, snapshotType: odds.snapshot_type },
    marketProbability: round6(marketProbability),
    factors: {
      pitcher: { evalPQS: round4(evalPQS), oppPQS: round4(oppPQS), ...pitcher },
      teamForm: { evalTPR, oppTPR, ...teamForm },
      lineMovement: { movementPct: movementPct !== null ? round4(movementPct) : null, timingCategory, ...lineMove },
      publicSplits: { publicBetPct, ...publicSplits },
      injury: { ...injury },
      weather: { ...weather },
      rest: { ...rest },
    },
    totalAdjustment: round6(totalAdjustment),
    uncappedTotalAdjustment: round6(uncappedTotal),
    modelProbability: round6(modelProbability),
    edgePercentage: round6(edgePercentage),
    pitcherGatePassed,
    decision,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 10: evaluateAllGames
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} date - YYYY-MM-DD
 * @param {object} bulkManualInputs - optional { [gameId]: { home: manualInputs, away: manualInputs } }
 * @returns {object} summary
 */
export async function evaluateAllGames(date, bulkManualInputs = {}) {
  const games = await select('games', `date=eq.${date}&status=eq.scheduled&order=created_at`);

  const results = [];
  const summary = { date, gamesEvaluated: 0, evaluations: 0, decisions: { bet: 0, lean: 0, watchlist: 0, pass: 0 }, errors: [] };

  for (const game of games) {
    const gameInputs = bulkManualInputs[game.id] || {};

    // Evaluate home team
    try {
      const homeResult = await evaluateGame(
        game.id,
        game.home_team,
        gameInputs.home || {}
      );
      results.push(homeResult);
      summary.evaluations++;
      summary.decisions[homeResult.decision]++;
    } catch (err) {
      summary.errors.push({ gameId: game.id, team: game.home_team, error: err.message });
    }

    // Evaluate away team
    try {
      const awayResult = await evaluateGame(
        game.id,
        game.away_team,
        gameInputs.away || {}
      );
      results.push(awayResult);
      summary.evaluations++;
      summary.decisions[awayResult.decision]++;
    } catch (err) {
      summary.errors.push({ gameId: game.id, team: game.away_team, error: err.message });
    }

    summary.gamesEvaluated++;
  }

  return { summary, results };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function round4(val) {
  return Math.round(val * 10000) / 10000;
}

function round6(val) {
  return Math.round(val * 1000000) / 1000000;
}
