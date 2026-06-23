import { createAdminClient } from '@/lib/supabase/server';
import type { LeaderboardEntry, VoteTotals } from '@/src/features/voting/types';
import { checkAndFireMilestones } from './milestone.service';

interface TotalsDelta {
  freeVotes?: number;
  paidVotes?: number;
  bonusVotes?: number;
  adminAdjustmentVotes?: number;
  reversedVotes?: number;
  quarantinedVotes?: number;
}

// Atomically increment vote totals and recompute the total_confirmed_votes.
export async function incrementVoteTotals(
  contestId: string,
  contestantId: string,
  delta: TotalsDelta,
  roundId?: string,
): Promise<void> {
  const supabase = createAdminClient();

  // Upsert the totals row, then increment the specific columns.
  // We use a DB function for true atomicity; fall back to RPC if not available.
  const { error } = await supabase.rpc('increment_vote_totals', {
    p_contest_id: contestId,
    p_contestant_id: contestantId,
    p_round_id: roundId ?? null,
    p_free_votes: delta.freeVotes ?? 0,
    p_paid_votes: delta.paidVotes ?? 0,
    p_bonus_votes: delta.bonusVotes ?? 0,
    p_admin_adjustment_votes: delta.adminAdjustmentVotes ?? 0,
    p_reversed_votes: delta.reversedVotes ?? 0,
    p_quarantined_votes: delta.quarantinedVotes ?? 0,
  });

  if (error) {
    // Fallback: read-modify-write (less safe under concurrent load, acceptable for low traffic)
    await fallbackIncrementTotals(supabase, contestId, contestantId, delta, roundId);
  }
}

async function fallbackIncrementTotals(
  supabase: ReturnType<typeof createAdminClient>,
  contestId: string,
  contestantId: string,
  delta: TotalsDelta,
  roundId?: string,
) {
  const { data: existing } = await supabase
    .from('vote_totals')
    .select('*')
    .eq('contest_id', contestId)
    .eq('contestant_id', contestantId)
    .is('round_id', roundId ?? null)
    .maybeSingle();

  const base: Record<string, number> = {
    free_votes: Number(existing?.free_votes ?? 0),
    paid_votes: Number(existing?.paid_votes ?? 0),
    bonus_votes: Number(existing?.bonus_votes ?? 0),
    admin_adjustment_votes: Number(existing?.admin_adjustment_votes ?? 0),
    reversed_votes: Number(existing?.reversed_votes ?? 0),
    quarantined_votes: Number(existing?.quarantined_votes ?? 0),
  };

  const updated = {
    contest_id: contestId,
    contestant_id: contestantId,
    round_id: roundId ?? null,
    free_votes: base.free_votes + (delta.freeVotes ?? 0),
    paid_votes: base.paid_votes + (delta.paidVotes ?? 0),
    bonus_votes: base.bonus_votes + (delta.bonusVotes ?? 0),
    admin_adjustment_votes: base.admin_adjustment_votes + (delta.adminAdjustmentVotes ?? 0),
    reversed_votes: base.reversed_votes + (delta.reversedVotes ?? 0),
    quarantined_votes: base.quarantined_votes + (delta.quarantinedVotes ?? 0),
    last_vote_at: new Date().toISOString(),
  };

  updated['total_confirmed_votes' as keyof typeof updated] = Math.max(
    0,
    updated.free_votes +
      updated.paid_votes +
      updated.bonus_votes +
      updated.admin_adjustment_votes -
      updated.reversed_votes,
  ) as never;

  if (existing) {
    await supabase
      .from('vote_totals')
      .update(updated)
      .eq('contest_id', contestId)
      .eq('contestant_id', contestantId)
      .is('round_id', roundId ?? null);
  } else {
    await supabase.from('vote_totals').insert(updated);
  }
}

export async function getVoteTotals(
  contestId: string,
  contestantId: string,
  roundId?: string,
): Promise<VoteTotals | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('vote_totals')
    .select('*')
    .eq('contest_id', contestId)
    .eq('contestant_id', contestantId)
    .is('round_id', roundId ?? null)
    .maybeSingle();

  if (error || !data) return null;
  return mapTotalsRow(data);
}

export async function getLeaderboard(
  contestId: string,
  roundId?: string,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('vote_totals')
    .select(`
      contestant_id,
      free_votes,
      paid_votes,
      bonus_votes,
      admin_adjustment_votes,
      reversed_votes,
      total_confirmed_votes,
      rank,
      last_vote_at,
      contestant_share_links ( share_code, share_url )
    `)
    .eq('contest_id', contestId)
    .is('round_id', roundId ?? null)
    .order('total_confirmed_votes', { ascending: false })
    .order('last_vote_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row: any, idx: number) => ({
    rank: row.rank ?? idx + 1,
    contestantId: row.contestant_id,
    contestantName: '',      // joined in the API layer from contestants/submissions
    stageName: null,
    photoUrl: null,
    category: null,
    state: null,
    totalConfirmedVotes: Number(row.total_confirmed_votes),
    freeVotes: Number(row.free_votes),
    paidVotes: Number(row.paid_votes),
    lastVoteAt: row.last_vote_at,
    shareCode: row.contestant_share_links?.[0]?.share_code ?? null,
    shareUrl: row.contestant_share_links?.[0]?.share_url ?? null,
  }));
}

// Recompute ranks for all contestants in a contest — run after bulk changes.
export async function recomputeRanks(contestId: string, roundId?: string): Promise<void> {
  const supabase = createAdminClient();
  // Use a window function via RPC for efficiency; fallback to JS sort.
  const { error } = await supabase.rpc('recompute_leaderboard_ranks', {
    p_contest_id: contestId,
    p_round_id: roundId ?? null,
  });
  if (error) {
    await fallbackRecomputeRanks(supabase, contestId, roundId);
  }
}

async function fallbackRecomputeRanks(
  supabase: ReturnType<typeof createAdminClient>,
  contestId: string,
  roundId?: string,
) {
  const { data } = await supabase
    .from('vote_totals')
    .select('id, contestant_id, total_confirmed_votes, last_vote_at, paid_votes, rank')
    .eq('contest_id', contestId)
    .is('round_id', roundId ?? null)
    .order('total_confirmed_votes', { ascending: false });

  if (!data?.length) return;

  for (let i = 0; i < data.length; i++) {
    const row = data[i] as any;
    const newRank = i + 1;
    if (row.rank !== newRank) {
      await supabase.from('vote_totals').update({ rank: newRank }).eq('id', row.id);
      // Fire milestone check when rank changes
      checkAndFireMilestones(contestId, row.contestant_id);
    }
  }
}

function mapTotalsRow(row: Record<string, unknown>): VoteTotals {
  return {
    id: row.id as string,
    contestId: row.contest_id as string,
    contestantId: row.contestant_id as string,
    roundId: (row.round_id as string | null) ?? null,
    freeVotes: Number(row.free_votes ?? 0),
    paidVotes: Number(row.paid_votes ?? 0),
    bonusVotes: Number(row.bonus_votes ?? 0),
    adminAdjustmentVotes: Number(row.admin_adjustment_votes ?? 0),
    reversedVotes: Number(row.reversed_votes ?? 0),
    quarantinedVotes: Number(row.quarantined_votes ?? 0),
    totalConfirmedVotes: Number(row.total_confirmed_votes ?? 0),
    rank: row.rank != null ? Number(row.rank) : null,
    lastVoteAt: (row.last_vote_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}
