import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/bets/performance  → aggregated CLV / win-rate stats
// GET /api/bets/discipline   → discipline score (bet-on-signal rate)
// Any other action returns 404

export default async function handler(req, res) {
  const { action } = req.query;

  if (action === 'performance') {
    return handlePerformance(req, res);
  }
  if (action === 'discipline') {
    return handleDiscipline(req, res);
  }
  return res.status(404).json({ error: `Unknown action: ${action}` });
}

// ── Performance ──────────────────────────────────────────────────────────────

async function handlePerformance(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { data: bets, error } = await supabase
      .from('bets')
      .select('id, odds_at_bet, stake_amount, model_decision_at_bet, result, payout, closing_implied_probability, implied_probability_at_bet')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!bets || bets.length === 0) {
      return res.status(200).json({
        totalBets: 0,
        avgClv: null,
        pctPositiveClv: null,
        winRate: null,
        roi: null,
        clvByDecision: {},
      });
    }

    const resolved = bets.filter(b => b.result === 'win' || b.result === 'loss');
    const withClv = bets.filter(b => b.closing_implied_probability !== null && b.implied_probability_at_bet !== null);

    const clvValues = withClv.map(b => b.closing_implied_probability - b.implied_probability_at_bet);
    const avgClv = clvValues.length > 0 ? clvValues.reduce((a, c) => a + c, 0) / clvValues.length : null;
    const pctPositiveClv = clvValues.length > 0 ? clvValues.filter(v => v > 0).length / clvValues.length : null;

    const wins = resolved.filter(b => b.result === 'win').length;
    const winRate = resolved.length > 0 ? wins / resolved.length : null;

    const totalStake = bets.reduce((a, b) => a + (b.stake_amount || 0), 0);
    const totalPayout = resolved.reduce((a, b) => a + (b.payout || 0), 0);
    const totalStakeResolved = resolved.reduce((a, b) => a + (b.stake_amount || 0), 0);
    const roi = totalStakeResolved > 0 ? (totalPayout - totalStakeResolved) / totalStakeResolved : null;

    // CLV by decision tier
    const decisions = ['bet', 'lean', 'watchlist', 'pass'];
    const clvByDecision = {};
    for (const d of decisions) {
      const group = withClv.filter(b => b.model_decision_at_bet?.toLowerCase() === d);
      if (group.length > 0) {
        const vals = group.map(b => b.closing_implied_probability - b.implied_probability_at_bet);
        clvByDecision[d] = {
          count: group.length,
          avgClv: vals.reduce((a, c) => a + c, 0) / vals.length,
        };
      }
    }

    // CLV trend (last 20 bets with CLV)
    const clvTrend = withClv.slice(0, 20).map(b => ({
      id: b.id,
      clv: b.closing_implied_probability - b.implied_probability_at_bet,
    }));

    return res.status(200).json({
      totalBets: bets.length,
      avgClv,
      pctPositiveClv,
      winRate,
      roi,
      clvByDecision,
      clvTrend,
    });
  } catch (err) {
    console.error('[performance]', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Discipline ────────────────────────────────────────────────────────────────

async function handleDiscipline(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    // Denominator: distinct game_ids where model scored bet or lean for any team
    const { data: signals, error: sigErr } = await supabase
      .from('model_scores')
      .select('game_id')
      .in('decision', ['bet', 'lean']);
    if (sigErr) throw sigErr;

    const betLeanGameIds = [...new Set((signals || []).map(r => r.game_id))];

    if (betLeanGameIds.length === 0) {
      return res.status(200).json({
        betLeanGames: 0,
        betsPlacedOnBetLean: 0,
        disciplineScore: null,
        note: 'No bet/lean signals recorded yet',
      });
    }

    // Numerator: which of those games actually have a bet logged
    const { data: placed, error: betErr } = await supabase
      .from('bets')
      .select('game_id')
      .in('game_id', betLeanGameIds);
    if (betErr) throw betErr;

    const bettedGameIds = new Set((placed || []).map(r => r.game_id));
    const betsPlacedOnBetLean = [...new Set([...bettedGameIds].filter(id => betLeanGameIds.includes(id)))].length;

    const disciplineScore = betsPlacedOnBetLean / betLeanGameIds.length;

    return res.status(200).json({
      betLeanGames: betLeanGameIds.length,
      betsPlacedOnBetLean,
      disciplineScore,
      note: `Bet placed on ${betsPlacedOnBetLean} of ${betLeanGameIds.length} Bet/Lean games`,
    });
  } catch (err) {
    console.error('[discipline]', err);
    return res.status(500).json({ error: err.message });
  }
}
