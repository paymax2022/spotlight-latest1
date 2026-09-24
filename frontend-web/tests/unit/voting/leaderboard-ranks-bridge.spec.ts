/**
 * UAT Batch 6 / VI-009 fix — bridgedRecomputeRanksForResults()
 * (frontend-web/src/server/voting-bridge/leaderboard-ranks.ts).
 *
 * Proves the bridge produces correct TIED ranks on both paths:
 *   - RPC succeeds -> ranks are read back from vote_totals.rank (written by
 *     the RPC's RANK() OVER (...)).
 *   - RPC errors -> the bridge's OWN fallback query (ordered by
 *     total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC NULLS
 *     LAST) assigns real RANK()-equivalent ranks in application code — ties
 *     get the SAME rank, not sequential array-index ranks like
 *     totals.service.ts's fallbackRecomputeRanks (see
 *     leaderboard-tiebreak.spec.ts, which documents that gap and is
 *     deliberately left unfixed there since totals.service.ts is protected).
 *
 * Module under test does NOT import totals.service.ts at all — only
 * @/lib/supabase/server is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { bridgedRecomputeRanksForResults } from '@/src/server/voting-bridge/leaderboard-ranks';
import { createAdminClient } from '@/lib/supabase/server';

function makeChain(finalResult: { data: any; error: any }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
  };
  // The last `.order(...)` call in each code path is awaited directly, so make
  // the chain itself thenable, resolving to finalResult.
  chain.then = (resolve: any) => resolve(finalResult);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bridgedRecomputeRanksForResults — RPC success path', () => {
  it('reads ranks back from vote_totals after the RPC assigns real tied ranks', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const readRows = [
      { contestant_id: 'enr-A', total_confirmed_votes: 50, paid_votes: 40, last_vote_at: '2026-01-01T00:00:00Z', rank: 1 },
      { contestant_id: 'enr-B', total_confirmed_votes: 50, paid_votes: 40, last_vote_at: '2026-01-01T00:00:00Z', rank: 1 },
      { contestant_id: 'enr-C', total_confirmed_votes: 30, paid_votes: 5, last_vote_at: '2026-01-02T00:00:00Z', rank: 3 },
    ];

    const mock: any = {
      rpc,
      from: vi.fn().mockReturnValue(makeChain({ data: readRows, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue(mock);

    const result = await bridgedRecomputeRanksForResults('contest-1', 'round-1');

    expect(rpc).toHaveBeenCalledWith('recompute_leaderboard_ranks', {
      p_contest_id: 'contest-1',
      p_round_id: 'round-1',
    });
    expect(result).toEqual([
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 50, paidVotes: 40 },
      { contestantId: 'enr-B', rank: 1, totalConfirmedVotes: 50, paidVotes: 40 },
      { contestantId: 'enr-C', rank: 3, totalConfirmedVotes: 30, paidVotes: 5 },
    ]);
  });
});

describe('bridgedRecomputeRanksForResults — RPC error fallback path', () => {
  it('computes real tied ranks (RANK()-equivalent) itself, not sequential array-index ranks', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    // Two contestants genuinely tied on (total_confirmed_votes, paid_votes,
    // last_vote_at); a third clearly behind. Correctly ordered/deduped input
    // (as the real ORDER BY would return it).
    const rows = [
      { contestant_id: 'enr-A', total_confirmed_votes: 50, paid_votes: 40, last_vote_at: '2026-01-01T00:00:00Z', rank: null },
      { contestant_id: 'enr-B', total_confirmed_votes: 50, paid_votes: 40, last_vote_at: '2026-01-01T00:00:00Z', rank: null },
      { contestant_id: 'enr-C', total_confirmed_votes: 30, paid_votes: 5, last_vote_at: '2026-01-02T00:00:00Z', rank: null },
    ];

    const mock: any = {
      rpc,
      from: vi.fn().mockReturnValue(makeChain({ data: rows, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue(mock);

    const result = await bridgedRecomputeRanksForResults('contest-1');

    // Both ties get rank 1 (SAME rank); the next distinct contestant gets
    // rank 3 (RANK() skips by tie size, unlike DENSE_RANK() which would give 2
    // and unlike array-index ranking which would give A=1,B=2,C=3).
    expect(result).toEqual([
      { contestantId: 'enr-A', rank: 1, totalConfirmedVotes: 50, paidVotes: 40 },
      { contestantId: 'enr-B', rank: 1, totalConfirmedVotes: 50, paidVotes: 40 },
      { contestantId: 'enr-C', rank: 3, totalConfirmedVotes: 30, paidVotes: 5 },
    ]);
  });

  it('breaks a total_confirmed_votes tie by paid_votes, not by return order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    // Same total_confirmed_votes, different paid_votes -> NOT a real tie, so
    // distinct ranks, ordered by paid_votes DESC.
    const rows = [
      { contestant_id: 'enr-B', total_confirmed_votes: 50, paid_votes: 40, last_vote_at: '2026-01-01T00:00:00Z', rank: null },
      { contestant_id: 'enr-A', total_confirmed_votes: 50, paid_votes: 10, last_vote_at: '2026-01-02T00:00:00Z', rank: null },
    ];

    const mock: any = {
      rpc,
      from: vi.fn().mockReturnValue(makeChain({ data: rows, error: null })),
    };
    vi.mocked(createAdminClient).mockReturnValue(mock);

    const result = await bridgedRecomputeRanksForResults('contest-1');

    expect(result).toEqual([
      { contestantId: 'enr-B', rank: 1, totalConfirmedVotes: 50, paidVotes: 40 },
      { contestantId: 'enr-A', rank: 2, totalConfirmedVotes: 50, paidVotes: 10 },
    ]);
  });
});
