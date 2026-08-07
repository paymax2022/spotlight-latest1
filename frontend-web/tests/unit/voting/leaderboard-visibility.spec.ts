/**
 * D-005 regression: the public leaderboard route must honor the PHASE-AWARE
 * effective visibility (getEffectiveVisibility), not the raw contest-level
 * settings flags. A phase can hide the leaderboard / counts / rank even when
 * the contest-level flags are permissive.
 *
 * Also pins: the frozen-snapshot path must redact counts/rank the same way as
 * the live path (VV-007 — no leak via cache/snapshot).
 *
 * Route under test: frontend-web/app/api/leaderboard/[contestId]/route.ts (NOT protected).
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

vi.mock('@/src/server/voting/totals.service', () => ({ getLeaderboard: vi.fn() }));
vi.mock('@/src/server/voting/free-vote.service', () => ({ getVotingSettings: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET } from '../../../app/api/leaderboard/[contestId]/route';
import { getLeaderboard } from '@/src/server/voting/totals.service';
import { getVotingSettings } from '@/src/server/voting/free-vote.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

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

function settings(overrides: Partial<Record<string, unknown>> = {}) {
  // Contest-level flags are PERMISSIVE here on purpose — the phase resolver
  // is the authority. Freeze is off unless a test enables it.
  return {
    showPublicLeaderboard: true,
    showPublicVoteCount: true,
    showPublicRank: true,
    leaderboardFreezeEnabled: false,
    leaderboardFreezeAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rank: 1,
    contestantId: 'enr-1',
    contestantName: 'Ada',
    stageName: 'Ada',
    photoUrl: null,
    category: null,
    state: null,
    totalConfirmedVotes: 100,
    freeVotes: 60,
    paidVotes: 40,
    lastVoteAt: null,
    shareCode: null,
    shareUrl: null,
    ...overrides,
  };
}

function ctx() {
  return { params: Promise.resolve({ contestId: 'contest-1' }) };
}
function request() {
  return new Request('http://localhost/api/leaderboard/contest-1', { method: 'GET' });
}

describe('GET /api/leaderboard/[contestId] — phase-aware visibility (D-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(getVotingSettings).mockResolvedValue(settings() as any);
    vi.mocked(getLeaderboard).mockResolvedValue([entry()] as any);
  });

  it('returns 403 when the ACTIVE PHASE hides the leaderboard, even if contest-level flag is public', async () => {
    // Contest-level showPublicLeaderboard=true (permissive) but phase hides it.
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showLeaderboard: false }) as any);

    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
  });

  it('strips vote counts from entries when effective visibility hides counts', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showVoteCount: false }) as any);

    const res = await GET(request(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.leaderboard).toHaveLength(1);
    expect(body.leaderboard[0].totalConfirmedVotes).toBeUndefined();
    expect(body.leaderboard[0].freeVotes).toBeUndefined();
    expect(body.leaderboard[0].paidVotes).toBeUndefined();
    // rank still present (rank visible)
    expect(body.leaderboard[0].rank).toBe(1);
  });

  it('strips rank from entries when effective visibility hides rank', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showRank: false }) as any);

    const res = await GET(request(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.leaderboard[0].rank).toBeUndefined();
    // counts still present (counts visible)
    expect(body.leaderboard[0].totalConfirmedVotes).toBe(100);
  });

  it('returns full data when effective visibility is fully public', async () => {
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await GET(request(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.leaderboard[0].totalConfirmedVotes).toBe(100);
    expect(body.leaderboard[0].rank).toBe(1);
  });

  it('redacts counts in the FROZEN SNAPSHOT path too (no leak via cache)', async () => {
    // Enable freeze with a past timestamp so the snapshot branch is taken.
    vi.mocked(getVotingSettings).mockResolvedValue(
      settings({ leaderboardFreezeEnabled: true, leaderboardFreezeAt: '2000-01-01T00:00:00Z' }) as any,
    );
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility({ showVoteCount: false }) as any);

    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        snapshot_at: '2026-07-30T00:00:00Z',
        snapshot_data: [entry({ rank: 1 }), entry({ rank: 2, contestantId: 'enr-2', totalConfirmedVotes: 80 })],
      },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const res = await GET(request(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.frozen).toBe(true);
    expect(Array.isArray(body.leaderboard)).toBe(true);
    for (const e of body.leaderboard) {
      expect(e.totalConfirmedVotes).toBeUndefined();
      expect(e.freeVotes).toBeUndefined();
      expect(e.paidVotes).toBeUndefined();
    }
  });
});
