// ═══════════════════════════════════════════════════════════════════════════════
// SHARPLINE MODEL ENGINE — M4
// 7-Factor Additive Adjustment Model (Walters Methodology)
// All scoring functions are PURE — no DB calls, no side effects.
// The orchestrator (evaluateGame) handles all data fetching.
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const FACTOR_MAX_ADJ = {
  pitcher:    4.80,
  teamForm:   3.00,
  lineMove:   2.40,
  publicSplit: 1.80,
  injury:     1.20,
  weather:    1.05,
  rest:       0.75,
};

export const TOTAL_ADJ_CAP = 15.0;
export const PROB_FLOOR = 0.05;   // 5%
export const PROB_CEILING = 0.95; // 95%
export const PITCHER_GATE_THRESHOLD = 2.0;

// ─────────────────────────────────────────────────────────────────────────────
// TASK 1: VIG REMOVAL
// M1 Spec Section 2 — convert American odds to true market probability
// ─────────────────────────────────────────────────────────────────────────────

export function impliedProbability(americanOdds) {
  const odds = Number(americanOdds);
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

export function removeVig(homeOdds, awayOdds) {
  const homeRaw = impliedProbability(homeOdds);
  const awayRaw = impliedProbability(awayOdds);
  const total = homeRaw + awayRaw;
  return {
    homeTrueProb: homeRaw / total,
    awayTrueProb: awayRaw / total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: PITCHER ADVANTAGE SCORE
// M1 Spec Section 3.1
// ─────────────────────────────────────────────────────────────────────────────

// Linear interpolation between anchor points for pitcher component scoring
// anchors: array of { value, score } sorted by value ascending
function interpolateScore(value, anchors) {
  if (value <= anchors[0].value) return anchors[0].score;
  if (value >= anchors[anchors.length - 1].value) return anchors[anchors.length - 1].score;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (value >= a.value && value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      return a.score + t * (b.score - a.score);
    }
  }
  return 5; // fallback
}

// ERA scoring: lower ERA = higher score
// 10=ERA≤2.50, 7=ERA 3.00-3.50 (midpoint 3.25), 5=ERA 3.50-4.00 (3.75), 3=ERA 4.50-5.00 (4.75), 1=ERA≥5.50
function scoreERA(era) {
  if (era === null || era === undefined) return 5;
  return interpolateScore(era, [
    { value: 0,    score: 10 },
    { value: 2.50, score: 10 },
    { value: 3.25, score: 7 },
    { value: 3.75, score: 5 },
    { value: 4.75, score: 3 },
    { value: 5.50, score: 1 },
    { value: 10.0, score: 1 },
  ]);
}

// WHIP scoring: lower WHIP = higher score
// 10=WHIP≤0.95, 7=WHIP 1.10-1.20 (1.15), 5=WHIP 1.25-1.35 (1.30), 3=WHIP 1.45-1.55 (1.50), 1=WHIP≥1.70
function scoreWHIP(whip) {
  if (whip === null || whip === undefined) return 5;
  return interpolateScore(whip, [
    { value: 0,    score: 10 },
    { value: 0.95, score: 10 },
    { value: 1.15, score: 7 },
    { value: 1.30, score: 5 },
    { value: 1.50, score: 3 },
    { value: 1.70, score: 1 },
    { value: 3.0,  score: 1 },
  ]);
}

// K/9 scoring: higher K/9 = higher score
// 10=K/9≥11.0, 7=K/9 9.0-10.0 (9.5), 5=K/9 7.5-8.5 (8.0), 3=K/9 5.5-6.5 (6.0), 1=K/9≤4.0
function scoreK9(k9) {
  if (k9 === null || k9 === undefined) return 5;
  return interpolateScore(k9, [
    { value: 0,    score: 1 },
    { value: 4.0,  score: 1 },
    { value: 6.0,  score: 3 },
    { value: 8.0,  score: 5 },
    { value: 9.5,  score: 7 },
    { value: 11.0, score: 10 },
    { value: 20.0, score: 10 },
  ]);
}

// Recent Form: average of ERA sub-score and WHIP sub-score from last 3 starts
// recentStarts: array of { era_for_start, whip_for_start }
function scoreRecentForm(recentStarts) {
  if (!recentStarts || recentStarts.length === 0) return 5;
  // Take last 3 (most recent)
  const last3 = recentStarts.slice(0, 3);
  // Weighted average of ERA and WHIP across starts (equal weight per start)
  let totalERA = 0;
  let totalWHIP = 0;
  let eraCount = 0;
  let whipCount = 0;
  for (const s of last3) {
    if (s.era_for_start !== null && s.era_for_start !== undefined) {
      totalERA += Number(s.era_for_start);
      eraCount++;
    }
    if (s.whip_for_start !== null && s.whip_for_start !== undefined) {
      totalWHIP += Number(s.whip_for_start);
      whipCount++;
    }
  }
  const avgERA = eraCount > 0 ? totalERA / eraCount : null;
  const avgWHIP = whipCount > 0 ? totalWHIP / whipCount : null;
  const eraScore = avgERA !== null ? scoreERA(avgERA) : 5;
  const whipScore = avgWHIP !== null ? scoreWHIP(avgWHIP) : 5;
  return (eraScore + whipScore) / 2;
}

// Home/Away Split: compare pitcher ERA at venue type vs overall
// venueERA: pitcher ERA at this venue type (home or away)
// overallERA: pitcher's overall season ERA
function scoreHomeAwaySplit(venueERA, overallERA) {
  if (venueERA === null || venueERA === undefined ||
      overallERA === null || overallERA === undefined || overallERA === 0) {
    return 5; // neutral
  }
  const diff = overallERA - venueERA; // positive = better at this venue
  // Scale: if better by 1+ ERA at venue → 10, if worse by 1+ → 1
  // Linear from 1 to 10 across -1.0 to +1.0 ERA diff
  const normalized = Math.max(-1, Math.min(1, diff));
  return 5.5 + normalized * 4.5; // range: 1 to 10
}

/**
 * Calculate Pitcher Quality Score (PQS) for one pitcher
 * @param {object} seasonStats - { era, whip, k_per_9 } from pitcher_stats
 * @param {array} recentStarts - from pitcher_recent_form, sorted most recent first
 * @param {string} venueType - 'home' or 'away'
 * @returns {number} PQS on 1-10 scale
 */
export function pitcherQualityScore(seasonStats, recentStarts, venueType) {
  if (!seasonStats) return 5.0; // missing pitcher → neutral

  const era = seasonStats.era !== null ? Number(seasonStats.era) : null;
  const whip = seasonStats.whip !== null ? Number(seasonStats.whip) : null;
  const k9 = seasonStats.k_per_9 !== null ? Number(seasonStats.k_per_9) : null;

  const eraComponent = scoreERA(era) * 0.30;
  const whipComponent = scoreWHIP(whip) * 0.25;
  const k9Component = scoreK9(k9) * 0.20;
  const recentComponent = scoreRecentForm(recentStarts || []) * 0.15;

  // Home/Away split: compute venue-specific ERA from recent form
  let venueERA = null;
  if (recentStarts && recentStarts.length > 0 && venueType) {
    const venueStarts = recentStarts.filter(s => s.home_or_away === venueType);
    if (venueStarts.length > 0) {
      const validERAs = venueStarts
        .filter(s => s.era_for_start !== null && s.era_for_start !== undefined)
        .map(s => Number(s.era_for_start));
      if (validERAs.length > 0) {
        venueERA = validERAs.reduce((a, b) => a + b, 0) / validERAs.length;
      }
    }
  }
  const haSplitComponent = scoreHomeAwaySplit(venueERA, era) * 0.10;

  return eraComponent + whipComponent + k9Component + recentComponent + haSplitComponent;
}

/**
 * TASK 2: Calculate Pitcher Advantage Score
 * @param {number} evalPQS - PQS of evaluated team's pitcher
 * @param {number} oppPQS - PQS of opponent's pitcher
 * @returns {{ score: number, adjustment: number }}
 */
export function scorePitcherAdvantage(evalPQS, oppPQS) {
  // Raw differential: -9 to +9 practically
  const rawDiff = evalPQS - oppPQS;
  // Normalize to -10 to +10: max practical PQS diff is ~9, so scale by 10/9
  const score = clamp(rawDiff * (10 / 9), -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.pitcher;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3: TEAM FORM SCORE
// M1 Spec Section 3.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} evalTPR - evaluated team's current TPR (1-100)
 * @param {number} oppTPR - opponent's current TPR (1-100)
 * @param {object} recencyData - { evalLast10Wins, evalTPR, oppLast10Wins, oppTPR } for dampening check
 * @returns {{ score: number, adjustment: number }}
 */
export function scoreTeamForm(evalTPR, oppTPR, recencyData = null) {
  if (evalTPR === null || evalTPR === undefined ||
      oppTPR === null || oppTPR === undefined) {
    return { score: 0, adjustment: 0 };
  }

  const MAX_TPR_DIFF = 40;
  let score = ((evalTPR - oppTPR) / MAX_TPR_DIFF) * 10;
  score = clamp(score, -10, 10);

  // Recency modifier: dampening factor 0.8 if recent performance diverges from TPR
  if (recencyData) {
    const { evalLast10Wins, oppLast10Wins } = recencyData;
    // Evaluated team: high TPR but losing (3-7 or worse in last 10 with TPR > 60)
    if (evalTPR > 60 && evalLast10Wins !== null && evalLast10Wins <= 3) {
      score *= 0.8;
    }
    // Evaluated team: low TPR but winning (7-3 or better in last 10 with TPR < 40)
    if (evalTPR < 40 && evalLast10Wins !== null && evalLast10Wins >= 7) {
      score *= 0.8;
    }
    // Opponent: high TPR but losing
    if (oppTPR > 60 && oppLast10Wins !== null && oppLast10Wins <= 3) {
      score *= 0.8;
    }
    // Opponent: low TPR but winning
    if (oppTPR < 40 && oppLast10Wins !== null && oppLast10Wins >= 7) {
      score *= 0.8;
    }
  }

  score = clamp(score, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.teamForm;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4: LINE MOVEMENT SCORE
// M1 Spec Section 3.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} movementPct - current implied prob - opening implied prob (in percentage points, e.g. +3.5 means +3.5%)
 * @param {string} timingCategory - 'before_gameday' | 'day_of' | 'close_to_gametime'
 * @returns {{ score: number, adjustment: number }}
 */
export function scoreLineMovement(movementPct, timingCategory = 'day_of') {
  if (movementPct === null || movementPct === undefined) {
    return { score: 0, adjustment: 0 };
  }

  let score;
  const m = movementPct * 100; // convert from decimal to percentage points if needed
  // movementPct is already in percentage points (e.g. 5.0 means +5%)
  const mv = movementPct;

  if (mv >= 5)        score = 8 + (Math.min(mv, 10) - 5) * (2 / 5); // 8 to 10
  else if (mv >= 3)   score = 5 + (mv - 3) * (2 / 2);                // 5 to 7
  else if (mv >= 1)   score = 2 + (mv - 1) * (2 / 2);                // 2 to 4
  else if (mv >= -1)  score = -1 + (mv + 1) * (2 / 2);               // -1 to 1
  else if (mv >= -3)  score = -4 + (mv + 3) * (2 / 2);               // -4 to -2
  else if (mv >= -5)  score = -7 + (mv + 5) * (2 / 2);               // -7 to -5
  else                score = -10 + (Math.max(mv, -10) + 10) * (2 / 5); // -10 to -8

  // Timing modifier
  const timingMultiplier =
    timingCategory === 'before_gameday' ? 1.2 :
    timingCategory === 'close_to_gametime' ? 0.8 :
    1.0; // day_of default

  score = clamp(score * timingMultiplier, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.lineMove;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 5: PUBLIC SPLITS SCORE
// M1 Spec Section 3.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} publicBetPct - % of public bets on the EVALUATED team (0-100). Default 50.
 * @param {number|null} lineMovementScore - the line movement score (for confirmation modifier)
 * @returns {{ score: number, adjustment: number }}
 */
export function scorePublicSplits(publicBetPct = 50, lineMovementScore = null) {
  if (publicBetPct === null || publicBetPct === undefined) publicBetPct = 50;

  // Contrarian Gap = Public Bet % on opponent - Public Bet % on evaluated team
  const opponentPct = 100 - publicBetPct;
  const contrarianGap = opponentPct - publicBetPct; // positive = public on opponent

  let score;
  if (contrarianGap >= 50)       score = 7 + (Math.min(contrarianGap, 60) - 50) * (3 / 10); // 7 to 10
  else if (contrarianGap >= 30)  score = 4 + (contrarianGap - 30) * (3 / 20);                 // 4 to 6 (opp 65-74%)
  else if (contrarianGap >= 10)  score = 1 + (contrarianGap - 10) * (2 / 20);                 // 1 to 3 (opp 55-64%)
  else if (contrarianGap >= -10) score = -1 + (contrarianGap + 10) * (2 / 20);                // -1 to 1 (45-55%)
  else if (contrarianGap >= -30) score = -3 + (contrarianGap + 30) * (2 / 20);                // -3 to -1 (eval 55-64%)
  else if (contrarianGap >= -50) score = -6 + (contrarianGap + 50) * (3 / 20);                // -6 to -4 (eval 65-74%)
  else                           score = -10 + (Math.max(contrarianGap, -60) + 60) * (3 / 10); // -10 to -7

  // Line confirmation modifier
  if (lineMovementScore !== null) {
    // Line moving AGAINST public money = line moving toward evaluated team while public is on opponent
    // If contrarianGap > 0 (public on opponent) and line is moving toward eval team (positive lineMovementScore)
    // → confirmed sharp signal → ×1.3
    // If moving WITH public → ×0.7
    const publicOnOpponent = contrarianGap > 10;
    const publicOnEval = contrarianGap < -10;
    const lineTowardEval = lineMovementScore > 0;
    const lineAwayFromEval = lineMovementScore < 0;

    if ((publicOnOpponent && lineTowardEval) || (publicOnEval && lineAwayFromEval)) {
      // Line moving AGAINST public money direction
      score *= 1.3;
    } else if ((publicOnOpponent && lineAwayFromEval) || (publicOnEval && lineTowardEval)) {
      // Line moving WITH public money direction
      score *= 0.7;
    }
  }

  score = clamp(score, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.publicSplit;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 6: INJURY IMPACT SCORE
// M1 Spec Section 4.1
// ─────────────────────────────────────────────────────────────────────────────

const INJURY_VALUES = {
  star:     3.5,
  quality:  2.0,
  role:     0.75,
  bullpen:  0.5,
  closer:   1.75,
};

/**
 * @param {object} injuryInputs - { evaluatedTeamInjuries: [{ value: 'star'|'quality'|'role'|'bullpen'|'closer' }], opponentInjuries: [...] }
 * @returns {{ score: number, adjustment: number }}
 */
export function scoreInjuryImpact(injuryInputs = null) {
  if (!injuryInputs) return { score: 0, adjustment: 0 };

  const evalImpact = (injuryInputs.evaluatedTeamInjuries || [])
    .reduce((sum, inj) => sum + (INJURY_VALUES[inj.value] || 0), 0);
  const oppImpact = (injuryInputs.opponentInjuries || [])
    .reduce((sum, inj) => sum + (INJURY_VALUES[inj.value] || 0), 0);

  // Net: positive = opponent more injured (advantage for evaluated team)
  const netImpact = oppImpact - evalImpact;

  // Normalize to -10 to +10
  // Max practical: 3 star injuries on one side = 10.5. Use 10 as normalization ceiling.
  const maxImpact = 10;
  let score = clamp((netImpact / maxImpact) * 10, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.injury;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 7: WEATHER SCORE
// M1 Spec Section 4.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} weatherInput - { venue_type: 'outdoor'|'dome', wind_speed, wind_direction: 'out'|'in'|'crosswind', temp_f, precip_pct }
 * @param {number} evalPitcherScore - evaluated team pitcher's PQS (to determine pitching advantage direction)
 * @param {number} oppPitcherScore - opponent pitcher's PQS
 * @returns {{ score: number, adjustment: number }}
 */
export function scoreWeather(weatherInput = null, evalPitcherScore = 5, oppPitcherScore = 5) {
  if (!weatherInput) return { score: 0, adjustment: 0 };
  if (weatherInput.venue_type === 'dome') return { score: 0, adjustment: 0 };

  let score = 0;
  const hasBetterPitching = evalPitcherScore > oppPitcherScore;

  // Wind effects
  const windSpeed = weatherInput.wind_speed || 0;
  if (windSpeed > 10) {
    if (weatherInput.wind_direction === 'out') {
      // Increases run scoring — favors better offense / worse pitching matchup
      // If we have better pitching, wind blowing out is slightly negative for us
      score += hasBetterPitching ? -2 : 2;
      if (windSpeed > 15) score += hasBetterPitching ? -1 : 1;
    } else if (weatherInput.wind_direction === 'in') {
      // Decreases run scoring — favors better pitching matchup
      score += hasBetterPitching ? 3 : -3;
      if (windSpeed > 15) score += hasBetterPitching ? 1 : -1;
    }
    // crosswind: minimal effect
  }

  // Temperature effects
  const temp = weatherInput.temp_f;
  if (temp !== null && temp !== undefined) {
    if (temp > 85) score += 1;  // slight increase in run scoring
    if (temp < 50) score -= 1;  // slight decrease
  }

  // Precipitation effects
  const precip = weatherInput.precip_pct || 0;
  if (precip > 50) {
    // Suppresses offense, favors better pitching
    score += hasBetterPitching ? 2 : -2;
  }

  score = clamp(score, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.weather;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 8: REST/SCHEDULE SCORE
// M1 Spec Section 4.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} restInput - { evaluatedTeamDaysOff, opponentDaysOff, evaluatedTeamDoubleheader, opponentDoubleheader, evaluatedTeamCrossCountry, opponentCrossCountry }
 * @returns {{ score: number, adjustment: number }}
 */
export function scoreRestSchedule(restInput = null) {
  if (!restInput) return { score: 0, adjustment: 0 };

  let score = 0;

  // Consecutive games without off day (approximated by daysOff = 0 for 4+ games)
  const evalDaysOff = restInput.evaluatedTeamDaysOff ?? null;
  const oppDaysOff = restInput.opponentDaysOff ?? null;

  if (oppDaysOff !== null && oppDaysOff === 0) {
    // Opponent has not had a day off — on consecutive game stretch
    if (evalDaysOff !== null && evalDaysOff >= 1) {
      score += 6; // opponent fatigued, eval team rested (+5 to +8 range)
    }
  }
  if (evalDaysOff !== null && evalDaysOff === 0) {
    if (oppDaysOff !== null && oppDaysOff >= 1) {
      score -= 6; // eval team fatigued
    }
  }

  // Doubleheader game 2
  if (restInput.opponentDoubleheader) score += 5;     // +4 to +7
  if (restInput.evaluatedTeamDoubleheader) score -= 5; // mirror

  // Cross-country travel overnight
  if (restInput.opponentCrossCountry) score += 4;     // +3 to +5
  if (restInput.evaluatedTeamCrossCountry) score -= 4;

  score = clamp(score, -10, 10);
  const adjustment = (score / 10) * FACTOR_MAX_ADJ.rest;
  return { score: round4(score), adjustment: round4(adjustment) };
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISION RULES
// M1 Spec Section 7
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number} edgePct - edge percentage (e.g. 4.98)
 * @param {boolean} pitcherGatePassed - whether |pitcher advantage score| >= 2.0
 * @returns {string} 'bet' | 'lean' | 'watchlist' | 'pass'
 */
export function applyDecisionRules(edgePct, pitcherGatePassed) {
  if (edgePct >= 6) {
    return pitcherGatePassed ? 'bet' : 'watchlist';
  }
  if (edgePct >= 3) {
    return pitcherGatePassed ? 'lean' : 'watchlist';
  }
  if (edgePct >= 2) {
    return 'watchlist';
  }
  return 'pass';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function round4(val) {
  return Math.round(val * 10000) / 10000;
}
