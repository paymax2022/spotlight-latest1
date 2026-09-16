/**
 * VV-004 regression: authorized admins must always see full vote counts and
 * rank on the admin leaderboard, regardless of the public/contestant hidden
 * state (getEffectiveVisibility is a PUBLIC-facing concern and must never be
 * consulted by this route) — and the route must be genuinely RBAC-gated, not
 * just "reachable with any bearer token."
 *
 * Route under test: frontend-web/app/api/admin/voting/[contestId]/leaderboard/route.ts
 * (NOT protected — only frontend-web/src/server/voting/*.service.ts + the public
 * votes/* routes are hook-protected; this is an admin route).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('@/src/server/voting/totals.service', () => ({
  getLeaderboard: vi.fn(),
  recomputeRanks: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));

import { GET } from '../../../app/api/admin/voting/[contestId]/leaderboard/route';
import { getLeaderboard } from '@/src/server/voting/totals.service';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const ORIGINAL_ADMIN_KEY = process.env.SPOTLIGHT_ADMIN_API_KEY;

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rank: 1,
    contestantId: 'enr-1',
    contestantName: '',
    stageName: null,
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

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/voting/contest-1/leaderboard', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/admin/voting/[contestId]/leaderboard — RBAC + full visibility for admins (VV-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPOTLIGHT_ADMIN_API_KEY = 'test-admin-key';
    vi.mocked(getLeaderboard).mockResolvedValue([entry()] as any);
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
  });

  it('401s with no credentials at all', async () => {
    const res = await GET(request(), ctx());
    expect(res.status).toBe(401);
  });

  it('403s a server-key caller claiming a role without votes:manage permission', async () => {
    const res = await GET(
      request({ 'x-admin-key': 'test-admin-key', 'x-admin-role': 'executive_readonly' }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });

  it('403s a JWT-authenticated caller whose DB role lacks votes:manage', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'support_agent' }, error: null }),
    } as any);

    const res = await GET(request({ authorization: 'Bearer user-token' }), ctx());
    expect(res.status).toBe(403);
  });

  it('returns FULL counts and rank to an authorized admin — no visibility gating applied', async () => {
    const res = await GET(
      request({ 'x-admin-key': 'test-admin-key', 'x-admin-role': 'super_admin' }),
      ctx(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.leaderboard).toHaveLength(1);
    expect(body.leaderboard[0].totalConfirmedVotes).toBe(100);
    expect(body.leaderboard[0].freeVotes).toBe(60);
    expect(body.leaderboard[0].paidVotes).toBe(40);
    expect(body.leaderboard[0].rank).toBe(1);
  });

  it('a contest_manager (has votes:manage) can also read the full leaderboard', async () => {
    const res = await GET(
      request({ 'x-admin-key': 'test-admin-key', 'x-admin-role': 'contest_manager' }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaderboard[0].totalConfirmedVotes).toBe(100);
  });

  afterEach(() => {
    process.env.SPOTLIGHT_ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
  });
});
