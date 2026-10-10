/**
 * Visibility-gate regression for GET /api/v1/contests/[id]/contestants (the
 * LIST route) — the wave-12 twin of the F6 detail fix (#611):
 *
 *   The list applied the approved/active status filter but emitted
 *   rank / voteCount / votePercent / isTopContestant unconditionally, ignoring
 *   getEffectiveVisibility — the same D-004-class leak /api/vote-page,
 *   /api/leaderboard and the contestant detail route already gate. Hidden
 *   fields are now omitted entirely (not nulled).
 *
 * Route under test: frontend-web/app/api/v1/contests/[id]/contestants/route.ts
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

import { GET } from '../../../app/api/v1/contests/[id]/contestants/route';
import { createAdminClient } from '@/lib/supabase/server';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

const CONTEST_ID = '22222222-2222-4222-8222-222222222222';

const ROSTER = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ada Lovelace',
    stage_name: 'Ada',
    category: 'Acting',
    state: 'Lagos',
    photo_url: null,
    status: 'approved',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Grace Hopper',
    stage_name: 'Grace',
    category: 'Music',
    state: 'Abuja',
    photo_url: null,
    status: 'active',
  },
];

const TOTALS = [
  { contestant_id: ROSTER[0].id, total_confirmed_votes: 100, rank: 1 },
  { contestant_id: ROSTER[1].id, total_confirmed_votes: 50, rank: 2 },
];

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

function primeSupabase(roster: unknown[] = ROSTER, totals: unknown[] = TOTALS) {
  const { mock } = makeSupabaseMock();
  // The route awaits two chained queries:
  //   1st .in() → contestants … .in('status', …)           (terminal await)
  //   2nd .in() → vote_totals … .in('contestant_id', ids)  (terminal await)
  // Resolving each .in() call with {data,error} makes the awaited chain
  // produce the rows for that query.
  mock.in
    .mockResolvedValueOnce({ data: roster, error: null })
    .mockResolvedValueOnce({ data: totals, error: null });
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return mock;
}

function call() {
  return GET(new Request(`http://x/api/v1/contests/${CONTEST_ID}/contestants`), {
    params: Promise.resolve({ id: CONTEST_ID }),
  });
}

describe('GET /api/v1/contests/[id]/contestants — visibility gate (list twin of F6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies the public status filter (approved/active) to the roster query', async () => {
    const mock = primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await call();

    expect(res.status).toBe(200);
    expect(mock.in).toHaveBeenCalledWith('status', ['approved', 'active']);
  });

  it('returns counts and rank when visibility is fully public', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(visibility() as any);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].voteCount).toBe(100);
    expect(body[0].rank).toBe(1);
    expect(body[0].isTopContestant).toBe(true);
    expect(body[0].votePercent).toBeDefined();
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
    for (const entry of body) {
      for (const field of ['voteCount', 'votePercent', 'rank', 'isTopContestant']) {
        expect(entry[field]).toBeUndefined();
      }
      // Identity fields stay — only the totals/rank are gated.
      expect(entry.id).toBeDefined();
      expect(entry.name).toBeDefined();
    }
  });

  it('hides counts but keeps rank when only vote-count is hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: false, showRank: true }) as any,
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].rank).toBe(1);
    expect(body[0].isTopContestant).toBe(true);
    expect(body[0].voteCount).toBeUndefined();
    expect(body[0].votePercent).toBeUndefined();
  });

  it('hides rank but keeps counts when only rank is hidden', async () => {
    primeSupabase();
    vi.mocked(getEffectiveVisibility).mockResolvedValue(
      visibility({ showVoteCount: true, showRank: false }) as any,
    );

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].voteCount).toBe(100);
    expect(body[0].rank).toBeUndefined();
    expect(body[0].isTopContestant).toBeUndefined();
  });

  it('returns [] for an empty roster without touching visibility', async () => {
    primeSupabase([], []);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(getEffectiveVisibility).not.toHaveBeenCalled();
  });
});
