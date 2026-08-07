/**
 * D-004 regression: the public vote-page data loader must NOT leak vote counts
 * or rank when admin visibility hides them.
 *
 * Before the fix, GET /api/vote-page returned `totals` (rank + all counts)
 * unconditionally, ignoring `show_public_vote_count` / `show_public_rank`.
 * These tests pin the fixed contract: totals are gated by getEffectiveVisibility.
 *
 * Route under test: frontend-web/app/api/vote-page/route.ts (NOT protected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(),
  getRemainingFreeVotes: vi.fn(),
}));
vi.mock('@/src/server/voting/paid-vote.service', () => ({ getActiveVotePackages: vi.fn() }));
vi.mock('@/src/server/voting/totals.service', () => ({ getVoteTotals: vi.fn() }));
vi.mock('@/src/server/voting/share.service', () => ({ getOrCreateShareLink: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));

// ── Import after mocks ────────────────────────────────────────────────────────
import { GET } from '../../../app/api/vote-page/route';
import { getVotingSettings, getRemainingFreeVotes } from '@/src/server/voting/free-vote.service';
import { getActiveVotePackages } from '@/src/server/voting/paid-vote.service';
import { getVoteTotals } from '@/src/server/voting/totals.service';
import { getOrCreateShareLink } from '@/src/server/voting/share.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

// ── Helpers ───────────────────────────────────────────────────────────────────
const CONTEST_ROW = { id: 'contest-1', name: 'Star Search', slug: 'star-search', status: 'active' };
const ENROLLMENT_ROW = {
  id: 'enr-1',
  stage_name: 'Ada',
  status: 'active',
  user_profiles: { id: 'u-1', full_name: 'Ada Lovelace', avatar_url: null, bio: null, state: 'Lagos' },
};
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

function primeSupabase() {
  const { mock, maybySingle } = makeSupabaseMock();
  // 1st maybeSingle → contest lookup, 2nd → contestant (bySlug) lookup
  maybySingle.mockResolvedValueOnce({ data: CONTEST_ROW, error: null });
  maybySingle.mockResolvedValueOnce({ data: ENROLLMENT_ROW, error: null });
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
}

function primeServices() {
  vi.mocked(getVotingSettings).mockResolvedValue({ votingEnabled: true } as any);
  vi.mocked(getActiveVotePackages).mockResolvedValue([] as any);
  vi.mocked(getVoteTotals).mockResolvedValue(TOTALS as any);
  vi.mocked(getOrCreateShareLink).mockResolvedValue(null as any);
  vi.mocked(getRemainingFreeVotes).mockResolvedValue({
    freeVotesRemaining: 1,
    freeVotesPerDay: 3,
    resetAt: '2026-07-31T00:00:00Z',
  } as any);
}

function request() {
  return new Request(
    'http://localhost/api/vote-page?contestSlug=star-search&contestantSlug=ada',
    { method: 'GET' },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/vote-page — vote-count visibility gating (D-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeServices();
  });

  it('returns counts and rank when visibility is fully public', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals).not.toBeNull();
    expect(body.totals.totalConfirmedVotes).toBe(100);
    expect(body.totals.freeVotes).toBe(60);
    expect(body.totals.paidVotes).toBe(40);
    expect(body.totals.rank).toBe(3);
  });

  it('omits ALL counts (totals=null) when both vote-count and rank are hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: false }) as any,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    // The leak: previously body.totals still carried the exact counts.
    expect(body.totals).toBeNull();
  });

  it('hides counts but keeps rank when only vote-count is hidden', async () => {
    primeSupabase();
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
    expect(body.totals.paidVotes).toBeUndefined();
  });

  it('hides rank but keeps counts when only rank is hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: true, showRank: false }) as any,
    );

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totals).not.toBeNull();
    expect(body.totals.totalConfirmedVotes).toBe(100);
    expect(body.totals.rank).toBeUndefined();
  });
});
