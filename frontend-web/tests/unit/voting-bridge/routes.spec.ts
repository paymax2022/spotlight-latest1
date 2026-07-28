/**
 * v2 vote route contract tests.
 *   POST /api/v2/votes/free
 *   POST /api/v2/votes/paid/verify
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedCastFreeVote: vi.fn(),
  bridgedVerifyPaidVote: vi.fn(),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/src/lib/auth/request', () => ({
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
import { requireRequestUser } from '@/src/lib/auth/request';

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
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with vote result on success', async () => {
    vi.mocked(bridgedCastFreeVote).mockResolvedValue(FREE_VOTE_RESULT as any);

    const req = makeRequest('/api/v2/votes/free', {
      body: { contestId: 'contest-001', contestantId: 'contestant-001' },
    });
    const res = await postFreeVote(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.votesAdded).toBe(1);
  });

  it('returns 400 when contestId is missing', async () => {
    const req = makeRequest('/api/v2/votes/free', {
      body: { contestantId: 'contestant-001' },
    });
    const res = await postFreeVote(req);
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false } as any);
    const req = makeRequest('/api/v2/votes/free', {
      body: { contestId: 'c-001', contestantId: 'cont-001' },
    });
    const res = await postFreeVote(req);
    expect(res.status).toBe(429);
  });

  it('propagates bridge errors (e.g. 403 from KYC gate)', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(bridgedCastFreeVote).mockRejectedValue(
      new ApiError('Account suspended.', 403),
    );
    const req = makeRequest('/api/v2/votes/free', {
      body: { contestId: 'c-001', contestantId: 'cont-001' },
    });
    const res = await postFreeVote(req);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v2/votes/paid/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-001', email: 'u@example.com' } as any);
  });

  it('returns 200 with verify result on success', async () => {
    vi.mocked(bridgedVerifyPaidVote).mockResolvedValue(VERIFY_RESULT as any);

    const req = makeRequest('/api/v2/votes/paid/verify', {
      body: { transactionId: 'tx-001', paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.votesCredited).toBe(10);
  });

  it('returns 400 when transactionId is missing', async () => {
    const req = makeRequest('/api/v2/votes/paid/verify', {
      body: { paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const req = makeRequest('/api/v2/votes/paid/verify', {
      body: { transactionId: 'tx-001', paymentReference: 'PAY_ref_001' },
    });
    const res = await postPaidVerify(req);
    expect(res.status).toBe(401);
  });
});
