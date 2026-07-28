/**
 * Golden-path suite: POST /api/votes/free
 *
 * Tests the route handler contract. Service functions and the rate limiter are
 * mocked so tests run without a database. The shapes asserted here are the
 * stable contract that bridge code and clients must not break.
 *
 * Protected source: frontend-web/app/api/votes/free/route.ts (DO NOT EDIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth, makeFreeVoteResult, makeSupabaseMock } from './_fixtures';

// ── Module mocks (hoisted by Vitest before imports) ──────────────────────────

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
  castFreeVote: vi.fn(),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from '../../../app/api/votes/free/route';
import { castFreeVote } from '@/src/server/voting/free-vote.service';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { createClient } from '@/lib/supabase/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVoteBody(overrides: Record<string, unknown> = {}) {
  return {
    contestId: 'contest-001',
    contestantId: 'contestant-abc',
    voteCount: 1,
    ...overrides,
  };
}

function allowRateLimit() {
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 29, resetInMs: 59000 });
}

function denyRateLimit() {
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetInMs: 59000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/votes/free', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowRateLimit();

    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
  });

  it('should cast a free vote and return vote counts', async () => {
    const expected = makeFreeVoteResult();
    vi.mocked(castFreeVote).mockResolvedValue(expected as any);

    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody(),
      ip: '10.0.0.1',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.votesAdded).toBe(1);
    expect(body.freeVotesRemaining).toBe(4);
    expect(body.fraudStatus).toBe('clean');
    expect(body.newTotalVotes).toBe(42);
  });

  it('should return 400 when contestId is missing', async () => {
    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody({ contestId: undefined }),
      ip: '10.0.0.2',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/contestId/i);
  });

  it('should return 400 when contestantId is missing', async () => {
    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody({ contestantId: undefined }),
      ip: '10.0.0.3',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/contestantId/i);
  });

  it('should return 429 when rate limit is exceeded', async () => {
    denyRateLimit();

    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody(),
      ip: '10.0.0.4',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too many/i);
  });

  it('should surface 429 when service signals daily limit exhausted', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(castFreeVote).mockRejectedValue(new ApiError('Daily vote limit reached', 429));

    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody(),
      ip: '10.0.0.5',
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/daily vote limit/i);
  });

  it('should return 200 with fraudStatus quarantined when fraud is detected', async () => {
    vi.mocked(castFreeVote).mockResolvedValue(
      makeFreeVoteResult({ fraudStatus: 'quarantined', votesAdded: 0 }) as any,
    );

    const req = makeRequest('/api/votes/free', { body: makeVoteBody(), ip: '10.0.0.6' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fraudStatus).toBe('quarantined');
    expect(body.votesAdded).toBe(0);
  });

  it('should pass userId from Bearer token to castFreeVote when authenticated', async () => {
    const { mock } = makeSupabaseMock();
    // Override auth.getUser to return a specific user
    mock.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'logged-in-user', email: 'me@example.com' } },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(castFreeVote).mockResolvedValue(makeFreeVoteResult() as any);

    const req = makeRequest('/api/votes/free', {
      body: makeVoteBody(),
      ip: '10.0.0.7',
      headers: withAuth(),
    });
    await POST(req);

    // castFreeVote should have received the userId from the token
    expect(vi.mocked(castFreeVote)).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'logged-in-user',
    );
  });

  it('should return 500 when service throws an unexpected error', async () => {
    vi.mocked(castFreeVote).mockRejectedValue(new Error('DB connection lost'));

    const req = makeRequest('/api/votes/free', { body: makeVoteBody(), ip: '10.0.0.8' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
