import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/games/today -- Daily game view data (M6)
// Returns today's games joined with model_scores, odds, bets
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed -- use GET' });
  }
  const today = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const { data: games, error: gErr } = await supabase
      .from('games')
      .select('*')
      .eq('date', today)
      .order('created_at');
    if (gErr) throw gErr;
    if (!games || games.length === 0) {
      return res.status(200).json({ date: today, games: [] });
    }
    const gameIds = games.map(g => g.id);

    const { data: allScores } = await supabase
      .from('model_scores')
      .select('*')
      .in('game_id', gameIds)
      .order('evaluated_at', { ascending: false });

    const scoreMap = {};
    for (const score of (allScores || [])) {
      const key = score.game_id + ':' + score.evaluated_team;
      if (!scoreMap[key]) scoreMap[key] = score;
    }

    const { data: allOdds } = await supabase
      .from('odds_snapshots')
      .select('*')
      .in('game_id', gameIds)
      .order('captured_at', { ascending: false });

    const oddsMap = {};
    for (const snap of (allOdds || [])) {
      if (!oddsMap[snap.game_id]) {
        oddsMap[snap.game_id] = snap;
      } else if (oddsMap[snap.game_id].snapshot_type !== 'current' && snap.snapshot_type === 'current') {
        oddsMap[snap.game_id] = snap;
      }
    }

    const { data: allBets } = await supabase
      .from('bets')
      .select('*')
      .in('game_id', gameIds)
      .order('created_at', { ascending: false });

    const betsMap = {};
    for (const bet of (allBets || [])) {
      if (!betsMap[bet.game_id]) betsMap[bet.game_id] = [];
      betsMap[bet.game_id].push(bet);
    }

    const result = games.map(game => {
      const homeScore = scoreMap[game.id + ':' + game.home_team] || null;
      const awayScore = scoreMap[game.id + ':' + game.away_team] || null;
      const odds = oddsMap[game.id] || null;
      const bets = betsMap[game.id] || [];

      let sortEdge = -9999;
      if (homeScore && homeScore.edge_percentage !== null) {
        sortEdge = Math.max(sortEdge, parseFloat(homeScore.edge_percentage));
      }
      if (awayScore && awayScore.edge_percentage !== null) {
        sortEdge = Math.max(sortEdge, parseFloat(awayScore.edge_percentage));
      }

      return {
        id: game.id,
        date: game.date,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        homePitcher: game.home_pitcher,
        awayPitcher: game.away_pitcher,
        venue: game.venue,
        status: game.status,
        sortEdge,
        odds: odds ? {
          homeMoneyline: odds.home_moneyline,
          awayMoneyline: odds.away_moneyline,
          homeImpliedProb: odds.home_implied_prob !== null ? parseFloat(odds.home_implied_prob) : null,
          awayImpliedProb: odds.away_implied_prob !== null ? parseFloat(odds.away_implied_prob) : null,
          snapshotType: odds.snapshot_type,
          capturedAt: odds.captured_at,
        } : null,
        homeModel: homeScore ? formatScore(homeScore) : null,
        awayModel: awayScore ? formatScore(awayScore) : null,
        bets: bets.map(b => ({
          id: b.id,
          teamBetOn: b.team_bet_on,
          oddsAtBet: b.odds_at_bet,
          stakeAmount: parseFloat(b.stake_amount),
          modelDecisionAtBet: b.model_decision_at_bet,
          createdAt: b.created_at,
        })),
      };
    });

    result.sort((a, b) => b.sortEdge - a.sortEdge);
    return res.status(200).json({ date: today, games: result });

  } catch (err) {
    console.error('[games/today]', err);
    return res.status(500).json({ error: err.message });
  }
}

function formatScore(score) {
  return {
    evaluatedTeam: score.evaluated_team,
    marketProbability: score.market_probability !== null ? parseFloat(score.market_probability) : null,
    modelProbability: score.model_probability !== null ? parseFloat(score.model_probability) : null,
    edgePercentage: score.edge_percentage !== null ? parseFloat(score.edge_percentage) : null,
    decision: score.decision,
    pitcherGatePassed: score.pitcher_gate_passed,
    factors: {
      pitcherAdvantage: score.pitcher_advantage_score !== null ? parseFloat(score.pitcher_advantage_score) : null,
      teamForm: score.team_form_score !== null ? parseFloat(score.team_form_score) : null,
      lineMovement: score.line_movement_score !== null ? parseFloat(score.line_movement_score) : null,
      publicSplits: score.public_splits_score !== null ? parseFloat(score.public_splits_score) : null,
      injuryImpact: score.injury_impact_score !== null ? parseFloat(score.injury_impact_score) : null,
      weather: score.weather_score !== null ? parseFloat(score.weather_score) : null,
      restSchedule: score.rest_schedule_score !== null ? parseFloat(score.rest_schedule_score) : null,
    },
    evaluatedAt: score.evaluated_at,
  };
}