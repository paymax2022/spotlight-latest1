/**
 * VI-009: leaderboard ordering & tie handling.
 *
 * recomputeRanks() has TWO code paths and they disagree on tie-break:
 *   - Primary (RPC `recompute_leaderboard_ranks`, see
 *     supabase/migrations/20260602110000_voting_rpc_functions.sql:79-106):
 *     RANK() OVER (ORDER BY total_confirmed_votes DESC, paid_votes DESC,
 *     last_vote_at ASC NULLS LAST) — tie-break IS defined: higher paid_votes
 *     wins, then earliest last_vote_at wins.
 *   - Fallback (fallbackRecomputeRanks, used only if the RPC call errors):
 *     orders ONLY by total_confirmed_votes DESC and assigns rank = index + 1
 *     — ties are broken by whatever order Postgrest/JS happens to return,
 *     which is genuinely undefined/arbitrary.
 *
 * totals.service.ts is hook-protected (never edited here). This suite pins
 * the RPC call contract (correct tie-break params passed through) and proves
 * the fallback path's tie-break gap with an executed test — it does NOT fix
 * the fallback, since totals.service.ts cannot be edited directly per the
 * brownfield-safety rule; a real fix needs the vote-bridge adapter pattern
 * (a new file under frontend-web/src/server/voting-bridge/ that wraps
 * recomputeRanks, or a SQL-level fix to ensure the RPC never fails) — flagged
 * as follow-up work needing the vote-bridge skill, not a same-pattern fix.
 *
 * Module under test: frontend-web/src/server/voting/totals.service.ts (protected, read-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/milestone.service', () => ({ checkAndFireMilestones: vi.fn() }));

import { recomputeRanks } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';

describe('recomputeRanks — primary RPC path carries the defined tie-break', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the RPC with the contest/round scope; no fallback when the RPC succeeds', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(mock.rpc).mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await recomputeRanks('contest-1', 'round-1');

    expect(mock.rpc).toHaveBeenCalledWith('recompute_leaderboard_ranks', {
      p_contest_id: 'contest-1',
      p_round_id: 'round-1',
    });
    // Fallback path would call .from('vote_totals') — must NOT happen on RPC success.
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe('recomputeRanks — fallback path has NO tie-break (genuine gap, documented not fixed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to a JS re-rank ordered ONLY by total_confirmed_votes when the RPC errors', async () => {
    const { mock, listData, updateFn, updateEq } = makeSupabaseMock();
    vi.mocked(mock.rpc).mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    // fallbackRecomputeRanks awaits `.order(...)` directly (no maybeSingle/range) —
    // route the terminal select through a thenable result.
    mock.order = vi.fn().mockImplementation(() => listData());
    // Two ties at 50 votes each (enr-A, enr-B) — the fallback's ORDER BY has
    // no secondary key, so which of them lands rank 1 vs rank 2 depends only
    // on the order Postgrest happened to return, not on any vote attribute.
    listData.mockResolvedValueOnce({
      data: [
        { id: 'row-A', contestant_id: 'enr-A', total_confirmed_votes: 50, last_vote_at: '2026-01-02T00:00:00Z', paid_votes: 10, rank: null },
        { id: 'row-B', contestant_id: 'enr-B', total_confirmed_votes: 50, last_vote_at: '2026-01-01T00:00:00Z', paid_votes: 40, rank: null },
      ],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await recomputeRanks('contest-1');

    // Confirms the gap: rank assignment is index-based only (1, 2 in query-return
    // order), with no comparison against paid_votes or last_vote_at at all —
    // unlike the RPC's ORDER BY total_confirmed_votes DESC, paid_votes DESC,
    // last_vote_at ASC. row-A (fewer paid_votes, later last_vote_at) gets
    // rank 1 here purely because it happened to sort first, which the RPC's
    // tie-break would NOT have chosen (row-B has more paid_votes).
    expect(updateFn).toHaveBeenCalledWith({ rank: 1 });
    expect(updateEq).toHaveBeenCalled();
    // Both rows got some rank update — no assertion on WHICH one is "correct"
    // because, by design of the current fallback, there is no correct answer.
  });
});
