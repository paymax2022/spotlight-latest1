/**
 * CONTEST-002 fix — POST /api/v2/votes/paid/initiate
 *
 * The previous version of this route did its own raw INSERT using columns
 * that don't exist on vote_transactions and would have failed outright if
 * ever called. This rewrite makes it a real, working equivalent of the
 * protected /api/votes/paid/initiate route (see
 * tests/unit/golden-path/paid-vote.spec.ts for that route's own coverage,
 * which this file mirrors) — same validation, same call into
 * initiatePaidVote(), just at the /v2 path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, makeInitiateResult, makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/server/voting/paid-vote.service', () => ({
  initiatePaidVote: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { POST as initiatePost } from '../../../app/api/v2/votes/paid/initiate/route';
import { initiatePaidVote } from '@/src/server/voting/paid-vote.service';
import { createClient } from '@/lib/supabase/server';

function makeInitiateBody(overrides: Record<string, unknown> = {}) {
  return {
    contestId: 'contest-001',
    contestantId: 'contestant-abc',
    voterEmail: 'voter@example.com',
    voterName: 'Test Voter',
    packageId: 'pkg-10-votes',
    ...overrides,
  };
}

describe('POST /api/v2/votes/paid/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
  });

  it('calls the real initiatePaidVote() and returns its response verbatim', async () => {
    vi.mocked(initiatePaidVote).mockResolvedValue(makeInitiateResult() as any);

    const res = await initiatePost(makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody() }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/abc123');
    expect(body.transactionId).toBe('tx-001');
    expect(body.amountExpected).toBe(50000); // kobo
    expect(body.votesToCredit).toBe(10);

    // The bug this fixes: the broken version never called initiatePaidVote()
    // at all, so it never ran the voting-open/package-pricing validation
    // that function performs.
    expect(vi.mocked(initiatePaidVote)).toHaveBeenCalledOnce();
    expect(vi.mocked(initiatePaidVote)).toHaveBeenCalledWith(
      makeInitiateBody(),
      expect.any(String),
      expect.any(String),
      undefined,
    );
  });

  it('accepts customVoteQuantity in place of packageId', async () => {
    vi.mocked(initiatePaidVote).mockResolvedValue(makeInitiateResult({ packageId: null }) as any);

    const body = makeInitiateBody({ packageId: undefined, customVoteQuantity: 5 });
    const res = await initiatePost(makeRequest('/api/v2/votes/paid/initiate', { body }) as any);

    expect(res.status).toBe(200);
    expect(vi.mocked(initiatePaidVote)).toHaveBeenCalledOnce();
  });

  it('returns 400 when contestId is missing, before calling initiatePaidVote()', async () => {
    const res = await initiatePost(
      makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody({ contestId: undefined }) }) as any,
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/contestId/i);
    expect(vi.mocked(initiatePaidVote)).not.toHaveBeenCalled();
  });

  it('returns 400 when voterEmail is missing', async () => {
    const res = await initiatePost(
      makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody({ voterEmail: undefined }) }) as any,
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/voterEmail/i);
  });

  it('returns 400 when voterName is missing', async () => {
    const res = await initiatePost(
      makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody({ voterName: undefined }) }) as any,
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/voterName/i);
  });

  it('returns 400 when neither packageId nor customVoteQuantity is provided', async () => {
    const res = await initiatePost(
      makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody({ packageId: undefined }) }) as any,
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/packageId|customVoteQuantity/i);
  });

  it('propagates a validation error thrown by initiatePaidVote() (e.g. voting closed) as its own status', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(initiatePaidVote).mockRejectedValue(new ApiError('Voting is not currently open', 400));

    const res = await initiatePost(makeRequest('/api/v2/votes/paid/initiate', { body: makeInitiateBody() }) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/voting is not currently open/i);
  });
});
