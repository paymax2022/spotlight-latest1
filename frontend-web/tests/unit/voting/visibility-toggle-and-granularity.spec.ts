/**
 * VV-005 + VV-008 regression, against the visibility RESOLUTION SEAM itself
 * (getEffectiveVisibility) rather than any one consuming route:
 *
 * VV-005 — Toggle hide→show (and back) applies immediately. getEffectiveVisibility
 *   holds no cache/memoization: it is a plain per-call DB read, so any consumer
 *   (vote-page, leaderboard, contestant self-view — all fixed to call it fresh
 *   per request) reflects a settings change on the very next request. This test
 *   proves there is no stale-read hazard at the seam: two consecutive calls with
 *   different underlying settings return different results.
 *
 * VV-008 — Per-audience granularity (hide public, show contestant). Today there
 *   is exactly ONE visibility resolution per contest (or per active phase) —
 *   `show_public_vote_count/leaderboard/rank` — and it is consumed identically
 *   by every surface (public vote-page, public leaderboard, and — after the
 *   VV-002 fix — the contestant's own self-view). There is no separate
 *   "audience" dimension (public vs. contestant vs. admin) in the schema or in
 *   getEffectiveVisibility's return shape. This test pins that CURRENT reality
 *   (not a new subsystem): the same visibility value is what every non-admin
 *   surface gets, so "hide from public but still show the contestant their own
 *   count" is NOT achievable with the current flags — it would need a new
 *   audience-scoped column (e.g. show_contestant_vote_count) plus updates to
 *   every consuming route, which is out of scope for a same-pattern fix and
 *   needs a product decision + larger scoped work.
 *
 * Module under test: frontend-web/src/server/voting/visibility.service.ts (NOT protected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

describe('getEffectiveVisibility — immediate toggle application (VV-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reflects a settings change on the very next call — no caching/memoization at the seam', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    // Call 1: admin has hidden everything.
    maybySingle.mockResolvedValueOnce({
      data: {
        show_public_vote_count: false,
        show_public_leaderboard: false,
        show_public_rank: false,
        active_phase_key: null,
      },
      error: null,
    });
    const before = await getEffectiveVisibility('contest-1');
    expect(before.showVoteCount).toBe(false);
    expect(before.showLeaderboard).toBe(false);
    expect(before.showRank).toBe(false);

    // Call 2 (simulating "admin flips the toggle, next request"): now visible.
    maybySingle.mockResolvedValueOnce({
      data: {
        show_public_vote_count: true,
        show_public_leaderboard: true,
        show_public_rank: true,
        active_phase_key: null,
      },
      error: null,
    });
    const after = await getEffectiveVisibility('contest-1');
    expect(after.showVoteCount).toBe(true);
    expect(after.showLeaderboard).toBe(true);
    expect(after.showRank).toBe(true);

    // Every call re-queried voting_settings — proves there is no cached/stale value.
    expect(maybySingle).toHaveBeenCalledTimes(2);
  });

  it('an active-phase override toggled off takes effect on the next call too', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const contestSettings = {
      show_public_vote_count: true,
      show_public_leaderboard: true,
      show_public_rank: true,
      active_phase_key: 'reveal',
    };

    // Call 1: phase hides the leaderboard.
    maybySingle
      .mockResolvedValueOnce({ data: contestSettings, error: null })
      .mockResolvedValueOnce({
        data: { phase_key: 'reveal', phase_label: 'Reveal', show_public_vote_count: true, show_public_leaderboard: false, show_public_rank: true },
        error: null,
      });
    const hidden = await getEffectiveVisibility('contest-1');
    expect(hidden.showLeaderboard).toBe(false);
    expect(hidden.source).toBe('phase');

    // Call 2: admin flips the phase's own flag back on.
    maybySingle
      .mockResolvedValueOnce({ data: contestSettings, error: null })
      .mockResolvedValueOnce({
        data: { phase_key: 'reveal', phase_label: 'Reveal', show_public_vote_count: true, show_public_leaderboard: true, show_public_rank: true },
        error: null,
      });
    const shown = await getEffectiveVisibility('contest-1');
    expect(shown.showLeaderboard).toBe(true);
  });
});

describe('getEffectiveVisibility — per-audience granularity is NOT modeled (VV-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ONE undifferentiated visibility value regardless of which "audience" is asking', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    maybySingle.mockResolvedValue({
      data: {
        show_public_vote_count: false,
        show_public_leaderboard: true,
        show_public_rank: true,
        active_phase_key: null,
      },
      error: null,
    });

    // There is no audience/actor parameter on getEffectiveVisibility — the
    // signature is (contestId) only. Calling it twice "as if" for two
    // different audiences necessarily returns the identical value, because
    // there is nothing in the function that could differentiate them.
    const forPublicSurface = await getEffectiveVisibility('contest-1');
    const forContestantSelfView = await getEffectiveVisibility('contest-1');

    expect(forPublicSurface).toEqual(forContestantSelfView);
    expect(forPublicSurface.showVoteCount).toBe(false);
    // Pin: a contestant CANNOT be shown their own count while it stays hidden
    // from the public with today's schema — that split does not exist yet.
  });
});
