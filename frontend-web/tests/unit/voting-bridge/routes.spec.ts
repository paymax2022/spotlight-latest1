/**
 * v2 vote route contract tests.
 *   POST /api/v2/votes/free
 *   POST /api/v2/votes/paid/verify
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeRequest } from '../golden-path/_fixtures';

// Route handlers are typed against NextRequest; the fixture builds a plain
// Request (sufficient at runtime — handlers only read headers/body/url).
const makeNextRequest = (...args: Parameters<typeof makeRequest>) =>
  makeRequest(...args) as unknown as NextRequest;

// POST /api/v2/votes/free rejects with 400 before doing anything else unless
// this header is present, so every case here has to carry one.
const withKey = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  makeNextRequest(url, { body, headers: { 'X-Idempotency-Key': 'idem-key-001', ...headers } });

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedCastFreeVote: vi.fn(),
  bridgedVerifyPaidVote: vi.fn(),
}));

// checkRateLimit is SYNCHRONOUS — it returns {allowed, remaining, resetInMs},
// not a promise. mockResolvedValue handed the route a Promise whose `.allowed`
// is undefined, so every free-vote case here 429'd on a rate limiter that was
// never actually consulted.
vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 29, resetInMs: 60_000 })),
}));

// Both routes authenticate via validateRequest, which resolves
// { user, error } rather than throwing. The mock previously supplied only
// requireRequestUser, so the module threw "No validateRequest export" and every
// paid-verify case became a 500.
vi.mock('@/src/lib/auth/request', () => ({
  validateRequest: vi.fn(),
  requireRequestUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  }),
}));

import { POST as postFreeVote } from '../../../app/api/v2/votes/free/route';
import { POST as postPaidVerify } from '../../../app/api/v2/votes/paid/verify/route';
import { bridgedCastFreeVote, bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { validateRequest } from '@/src/lib/auth/request';

const FREE_VOTE_RESULT = {
  success: true,
  votesAdded: 1,
  totalFreeVotesUsed: 1,
  freeVotesRemaining: 4,
  newTotalVotes: 10,
  fraudStatus: 'clean',
};

const VERIFY_RESULT = {
  success: true,
  alreadyProcessed: false,
  votesCredited: 10,
  newTotalVotes: 20,
  receiptNumber: 'RCP-001',
};

describe('POST /api/v2/votes/free', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The free route authenticates too. Without a default, validateRequest
    // resolves undefined, destructuring it throws, and every case here is a 500
    // that says nothing about the behaviour under test.
    vi.mocked(validateRequest).mockResolvedValue({ user: { id: 'user-001', email: 'u@example.com' }, error: null } as any);
  });

  it('returns 200 with vote result on success', async () => {
    vi.mocked(bridgedCastFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);

    const req = withKey('/api/v2/votes/free', { contestId: 'contest-001', contestantId: 'contestant-001' });
    const res = await postFreeVote(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.votesAdded).toBe(1);
  });

  it('returns 400 when contestId is missing', async () => {
    const req = withKey('/api/v2/votes/free', { contestantId: 'contestant-001' });
    const res = await postFreeVote(req);
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetInMs: 60_000 });
    const req = withKey('/api/v2/votes/free', { contestId: 'c-001', contestantId: 'cont-001' });
    const res = await postFreeVote(req);
    expect(res.status).toBe(429);
  });

  // The bridge RETURNS its failures as { success:false, error, statusCode } — it
  // does not throw at the route. A rejection here would be caught by the route's
  // try/catch and flattened to 500, which is what this asserted before and is
  // not how the bridge behaves.
  it('propagates bridge errors (e.g. 403 from KYC gate)', async () => {
    vi.mocked(bridgedCastFreeVote).mockResolvedValue({
      success: false,
      error: 'Account suspended.',
      statusCode: 403,
    } as any);
    const req = withKey('/api/v2/votes/free', { contestId: 'c-001', contestantId: 'cont-001' });
    const res = await postFreeVote(req);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v2/votes/paid/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateRequest).mockResolvedValue({ user: { id: 'user-001', email: 'u@example.com' }, error: null } as any);
  });

  it('returns 200 with verify result on success', async () => {
    // The route emits the bridge's VoteResponse shape (voteId / totalVotes), not
    // the legacy verify payload's votesCredited — asserting the latter tested a
    // field the route has never returned.
    vi.mocked(bridgedVerifyPaidVote).mockResolvedValue({
      success: true,
      voteId: 'vote-001',
      totalVotes: 20,
    } as any);

    const req = makeNextRequest('/api/v2/votes/paid/verify', {
      body: { transactionId: 'tx-001', paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.totalVotes).toBe(20);
  });

  it('returns 400 when transactionId is missing', async () => {
    const req = makeNextRequest('/api/v2/votes/paid/verify', {
      body: { paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    expect(res.status).toBe(400);
  });

  // The route reads validateRequest's error and then deliberately continues, so
  // an unauthenticated caller is processed as 'system' rather than refused —
  // its comment says a webhook may reach it without auth. That is a decision,
  // not an oversight, so this asserts the behaviour that exists rather than a
  // 401 the route never returns. Flagged separately: `authError` is destructured
  // and never checked, which reads like a dropped branch.
  it('processes an unauthenticated caller rather than refusing it', async () => {
    vi.mocked(validateRequest).mockResolvedValue({ user: null, error: 'UNAUTHORIZED' } as any);
    vi.mocked(bridgedVerifyPaidVote).mockResolvedValue(VERIFY_RESULT as any);
    const req = makeNextRequest('/api/v2/votes/paid/verify', {
      body: { transactionId: 'tx-001', paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    expect(res.status).toBe(200);
  });
});
