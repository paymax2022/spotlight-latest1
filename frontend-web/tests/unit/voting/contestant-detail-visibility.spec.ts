/**
 * Visibility-gate regression for GET /api/v1/contestants/[id] (wave-9 finding F6):
 *
 *   1. The detail route applied NO status gate — a pending/rejected contestant
 *      was resolvable by id while the public list only serves
 *      status IN ('approved','active'). The detail now applies the same filter,
 *      so a non-public contestant answers 404.
 *   2. The route returned voteCount / rank / votePercent / recentVotes /
 *      isTopContestant unconditionally, ignoring getEffectiveVisibility — the
 *      same D-004-class leak /api/vote-page and /api/leaderboard already gate.
 *      Hidden fields are now omitted entirely (not nulled).
 *
 * Route under test: frontend-web/app/api/v1/contestants/[id]/route.ts (NOT protected).
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

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/voting/visibility.service', () => ({ getEffectiveVisibility: vi.fn() }));

import { GET } from '../../../app/api/v1/contestants/[id]/route';
import { createAdminClient } from '@/lib/supabase/server';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

const CONTESTANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTEST_ID = '22222222-2222-4222-8222-222222222222';

const CONTESTANT_ROW = {
  id: CONTESTANT_ID,
  contest_id: CONTEST_ID,
  name: 'Ada Lovelace',
  stage_name: 'Ada',
  bio: null,
  photo_url: null,
  category: 'Acting',
  state: 'Lagos',
  media_url: null,
  status: 'approved',
  voting_link_slug: 'ada',
  total_votes: 100,
  ranking: 3,
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

function primeSupabase(contestantRow: unknown = CONTESTANT_ROW) {
  const { mock, maybySingle } = makeSupabaseMock();
  // 1st maybeSingle → contestants lookup (with .in('status', …) gate)
  maybySingle.mockResolvedValueOnce({ data: contestantRow, error: null });
  // 2nd maybeSingle → vote_totals row
  maybySingle.mockResolvedValueOnce({
    data: { total_confirmed_votes: 100, free_votes: 60, paid_votes: 40, rank: 3 },
    error: null,
  });
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return mock;
}

function call() {
  return GET(new Request(`http://x/api/v1/contestants/${CONTESTANT_ID}`), {
    params: Promise.resolve({ id: CONTESTANT_ID }),
  });
}

describe('GET /api/v1/contestants/[id] — visibility gate (F6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the public status filter (approved/active) to the detail lookup', async () => {
    const mock = primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await call();

    expect(res.status).toBe(200);
    expect(mock.in).toHaveBeenCalledWith('status', ['approved', 'active']);
  });

  it('404s when the contestant row does not survive the status gate', async () => {
    primeSupabase(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('returns counts and rank when visibility is fully public', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voteCount).toBe(100);
    expect(body.rank).toBe(3);
    expect(body.isTopContestant).toBe(true);
    expect(body.recentVotes).toBe(60);
    expect(body.votePercent).toBeDefined();
  });

  it('omits counts and rank entirely when visibility hides them', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: false }) as any,
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    // The leak: previously every field shipped regardless of the flags.
    for (const field of ['voteCount', 'votePercent', 'recentVotes', 'rank', 'isTopContestant']) {
      expect(body[field]).toBeUndefined();
    }
    // Identity fields stay — only the totals/rank are gated.
    expect(body.id).toBe(CONTESTANT_ID);
    expect(body.name).toBe('Ada Lovelace');
  });

  it('hides counts but keeps rank when only vote-count is hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: true }) as any,
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rank).toBe(3);
    expect(body.voteCount).toBeUndefined();
    expect(body.votePercent).toBeUndefined();
    expect(body.recentVotes).toBeUndefined();
  });

  it('hides rank but keeps counts when only rank is hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: true, showRank: false }) as any,
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voteCount).toBe(100);
    expect(body.rank).toBeUndefined();
    expect(body.isTopContestant).toBeUndefined();
  });
});
