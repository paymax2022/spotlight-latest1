/**
 * VI-007: contestant vote counts must be isolated per contest — no
 * cross-contest bleed for the same contestant/enrollment id (relevant since
 * a person can be enrolled as a contestant in more than one contest).
 *
 * totals.service.ts is a hook-protected file — read/imported here (never
 * edited) and exercised through its public exports (getVoteTotals,
 * getLeaderboard) with a mocked Supabase client.
 *
 * Module under test: frontend-web/src/server/voting/totals.service.ts (protected, read-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/milestone.service', () => ({ checkAndFireMilestones: vi.fn() }));

import { getVoteTotals, getLeaderboard } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';

describe('getVoteTotals — per-contest isolation (VI-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes the query by BOTH contest_id and contestant_id — same contestant, different contest, independent totals', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    maybySingle.mockResolvedValueOnce({
      data: {
        id: 't-1', contest_id: 'contest-A', contestant_id: 'enr-shared', round_id: null,
        free_votes: 10, paid_votes: 5, bonus_votes: 0, admin_adjustment_votes: 0,
        reversed_votes: 0, quarantined_votes: 0, total_confirmed_votes: 15, rank: 1,
        last_vote_at: null, updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    const totalsA = await getVoteTotals('contest-A', 'enr-shared');

    maybySingle.mockResolvedValueOnce({
      data: {
        id: 't-2', contest_id: 'contest-B', contestant_id: 'enr-shared', round_id: null,
        free_votes: 900, paid_votes: 800, bonus_votes: 0, admin_adjustment_votes: 0,
        reversed_votes: 0, quarantined_votes: 0, total_confirmed_votes: 1700, rank: 1,
        last_vote_at: null, updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    const totalsB = await getVoteTotals('contest-B', 'enr-shared');

    // No bleed: the same contestant id in a different contest is a wholly
    // independent row/number — contest-A's huge-number bug would show up here.
    expect(totalsA!.totalConfirmedVotes).toBe(15);
    expect(totalsB!.totalConfirmedVotes).toBe(1700);
    expect(totalsA!.contestId).toBe('contest-A');
    expect(totalsB!.contestId).toBe('contest-B');

    // Both calls filtered on contest_id via .eq — confirms the isolation key
    // includes contest_id, not just contestant_id.
    expect(mock.eq).toHaveBeenCalledWith('contest_id', 'contest-A');
    expect(mock.eq).toHaveBeenCalledWith('contest_id', 'contest-B');
    expect(mock.eq).toHaveBeenCalledWith('contestant_id', 'enr-shared');
  });

  it('returns null (not another contestant\'s row) when there is no totals row for this contest+contestant pair', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const totals = await getVoteTotals('contest-A', 'enr-never-voted');
    expect(totals).toBeNull();
  });
});

describe('getLeaderboard — per-contest isolation (VI-007, ties EC-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters the leaderboard query by contest_id — one contest\'s entries never include another\'s', async () => {
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValueOnce({
      data: [
        { contestant_id: 'enr-1', free_votes: 10, paid_votes: 5, bonus_votes: 0, admin_adjustment_votes: 0, reversed_votes: 0, total_confirmed_votes: 15, rank: 1, last_vote_at: null, contestant_share_links: [] },
      ],
      error: null,
    });
    // getLeaderboard awaits a chain ending in `.limit()` directly (no .range()).
    // Route it through the range-based terminal so the awaited result resolves.
    mock.limit = vi.fn().mockImplementation(() => listData());
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const board = await getLeaderboard('contest-A');

    expect(mock.eq).toHaveBeenCalledWith('contest_id', 'contest-A');
    expect(board).toHaveLength(1);
    expect(board[0].contestantId).toBe('enr-1');
  });
});
