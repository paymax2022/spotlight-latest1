/**
 * VV-002 regression: a contestant's OWN self-view (GET /api/contestant/votes/summary)
 * must honor the same admin-configured visibility (public flags + active-phase
 * override, via getEffectiveVisibility) that gates the public vote-page (D-004)
 * and public leaderboard (D-005). Before this fix, the route returned `totals`
 * (exact counts + rank) unconditionally, so "hide votes from contestants" had
 * no effect on a contestant looking at their own dashboard.
 *
 * Route under test: frontend-web/app/api/contestant/votes/summary/route.ts (NOT protected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ getVoteTotals: vi.fn() }));
vi.mock('@/src/server/voting/share.service', () => ({ getOrCreateShareLink: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '../../../app/api/contestant/votes/summary/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getVoteTotals } from '@/src/server/voting/totals.service';
import { getOrCreateShareLink } from '@/src/server/voting/share.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

const ENROLLMENT_ROW = { id: 'enr-1', stage_name: 'Ada' };
const TOTALS = {
  id: 't-1',
  contestId: 'contest-1',
  contestantId: 'enr-1',
  roundId: null,
  rank: 3,
  totalConfirmedVotes: 100,
  freeVotes: 60,
  paidVotes: 40,
  bonusVotes: 0,
  adminAdjustmentVotes: 0,
  reversedVotes: 0,
  quarantinedVotes: 0,
  lastVoteAt: null,
  updatedAt: '2026-07-30T00:00:00Z',
};

function visibility(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    showVoteCount: true,
    showLeaderboard: true,
    showRank: true,
    activePhaseKey: null,
    activePhaseLabel: null,
    source: 'contest',
    ...overrides,
  };
}

function request() {
  return new Request('http://localhost/api/contestant/votes/summary?contestId=contest-1', {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/contestant/votes/summary — self-view visibility gating (VV-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    vi.mocked(getVoteTotals).mockResolvedValue(TOTALS as any);
    vi.mocked(getOrCreateShareLink).mockResolvedValue(null as any);

    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: ENROLLMENT_ROW, error: null }); // enrollment lookup
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });

  it('returns full counts and rank to the contestant when visibility is fully public', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals).not.toBeNull();
    expect(body.totals.totalConfirmedVotes).toBe(100);
    expect(body.totals.freeVotes).toBe(60);
    expect(body.totals.paidVotes).toBe(40);
    expect(body.totals.rank).toBe(3);
    expect(body.currentRank).toBe(3);
  });

  it('hides counts from the contestant when admin hides vote counts (totals=null, no rank leak of count fields)', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: false }) as any,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    // The leak this test pins: the contestant must not receive exact counts
    // or rank when the admin has hidden both — same contract as D-004.
    expect(body.totals).toBeNull();
    expect(body.currentRank).toBeNull();
    expect(body.votesToNextRank).toBe(0);
  });

  it('hides counts but keeps rank visible to the contestant when only vote-count is hidden', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: true }) as any,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals).not.toBeNull();
    expect(body.totals.rank).toBe(3);
    expect(body.totals.totalConfirmedVotes).toBeUndefined();
    expect(body.totals.freeVotes).toBeUndefined();
    expect(body.currentRank).toBe(3);
  });

  it('hides rank but keeps counts visible to the contestant when only rank is hidden', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: true, showRank: false }) as any,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals).not.toBeNull();
    expect(body.totals.totalConfirmedVotes).toBe(100);
    expect(body.totals.rank).toBeUndefined();
    expect(body.currentRank).toBeNull();
  });

  it('still 403s a user who is not enrolled in the contest, regardless of visibility', async () => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // not enrolled
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await GET(request());
    expect(res.status).toBe(403);
  });
});
