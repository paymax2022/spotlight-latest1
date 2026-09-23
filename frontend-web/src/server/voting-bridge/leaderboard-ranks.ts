import { createAdminClient } from '@/lib/supabase/server';

/**
 * VI-009 bridge fix.
 *
 * The results-publish flow (app/api/admin/voting/rounds/[roundId]/publish-results)
 * must never go through totals.service.ts's fallbackRecomputeRanks(), which
 * orders vote_totals by total_confirmed_votes DESC ALONE and assigns rank by
 * array index — ties disagree with the primary RPC path
 * (recompute_leaderboard_ranks, supabase/migrations/20260602110000_voting_rpc_functions.sql:79-106),
 * which orders by total_confirmed_votes DESC, paid_votes DESC, last_vote_at
 * ASC NULLS LAST and assigns rank via RANK() OVER (...) — real tied ranks.
 *
 * This file is a NEW bridge-owned wrapper (frontend-web/src/server/voting-bridge/)
 * that does not import anything from totals.service.ts (which is
 * hook-protected and out of scope to edit), so it can never fall through to
 * the buggy fallback. It calls the same RPC directly; if the RPC call itself
 * errors, it runs its OWN correct fallback query here, replicating the same
 * three-key ORDER BY with proper RANK()-equivalent tie handling (two
 * contestants with an identical (total_confirmed_votes, paid_votes,
 * last_vote_at) tuple get the SAME rank, and the rank after a tie skips by
 * the tie size — standard SQL RANK() semantics, not sequential array-index
 * ranking).
 *
 * Scope note: tie-break itself is NOT configurable (scope decision, UAT
 * Batch 6) — this only guarantees the one existing, proven rule
 * (total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC NULLS LAST)
 * is applied consistently on the results-lock path.
 */

export interface BridgedRankEntry {
  contestantId: string;
  rank: number;
  totalConfirmedVotes: number;
  paidVotes: number;
}

interface VoteTotalsRow {
  contestant_id: string;
  total_confirmed_votes: number | string | null;
  paid_votes: number | string | null;
  last_vote_at: string | null;
  rank: number | null;
}

export async function bridgedRecomputeRanksForResults(
  contestId: string,
  roundId?: string,
): Promise<BridgedRankEntry[]> {
  const supabase = createAdminClient();

  const { error: rpcError } = await supabase.rpc('recompute_leaderboard_ranks', {
    p_contest_id: contestId,
    p_round_id: roundId ?? null,
  });

  if (!rpcError) {
    return loadRanksAfterRpc(supabase, contestId, roundId);
  }

  return fallbackComputeRanks(supabase, contestId, roundId);
}

async function loadRanksAfterRpc(
  supabase: ReturnType<typeof createAdminClient>,
  contestId: string,
  roundId?: string,
): Promise<BridgedRankEntry[]> {
  let query = supabase
    .from('vote_totals')
    .select('contestant_id, total_confirmed_votes, paid_votes, last_vote_at, rank')
    .eq('contest_id', contestId);

  query = roundId ? query.eq('round_id', roundId) : query.is('round_id', null);

  const { data, error } = await query.order('rank', { ascending: true, nullsFirst: false });
  if (error || !data) return [];

  return (data as VoteTotalsRow[]).map((row) => ({
    contestantId: row.contestant_id,
    rank: row.rank ?? 0,
    totalConfirmedVotes: Number(row.total_confirmed_votes ?? 0),
    paidVotes: Number(row.paid_votes ?? 0),
  }));
}

async function fallbackComputeRanks(
  supabase: ReturnType<typeof createAdminClient>,
  contestId: string,
  roundId?: string,
): Promise<BridgedRankEntry[]> {
  let query = supabase
    .from('vote_totals')
    .select('contestant_id, total_confirmed_votes, paid_votes, last_vote_at, rank')
    .eq('contest_id', contestId);

  query = roundId ? query.eq('round_id', roundId) : query.is('round_id', null);

  const { data, error } = await query
    .order('total_confirmed_votes', { ascending: false })
    .order('paid_votes', { ascending: false })
    .order('last_vote_at', { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  const rows = data as VoteTotalsRow[];

  // Replicate RANK() OVER (ORDER BY total_confirmed_votes DESC, paid_votes DESC,
  // last_vote_at ASC NULLS LAST): rows sharing the same (votes, paidVotes,
  // lastVoteAt) tuple get the SAME rank, and the next distinct tuple's rank is
  // its 1-based position in the sorted list (i.e. rank skips by tie size —
  // real RANK() behavior, not DENSE_RANK() and not sequential index ranking).
  const results: BridgedRankEntry[] = [];
  let previousKey: string | null = null;
  let previousRank = 0;

  rows.forEach((row, index) => {
    const totalConfirmedVotes = Number(row.total_confirmed_votes ?? 0);
    const paidVotes = Number(row.paid_votes ?? 0);
    const key = `${totalConfirmedVotes}|${paidVotes}|${row.last_vote_at ?? ''}`;

    const rank = key === previousKey ? previousRank : index + 1;
    previousKey = key;
    previousRank = rank;

    results.push({
      contestantId: row.contestant_id,
      rank,
      totalConfirmedVotes,
      paidVotes,
    });
  });

  return results;
}
