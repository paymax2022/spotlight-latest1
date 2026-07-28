/**
 * Golden-path suite: paid vote routes
 *   POST /api/votes/paid/initiate
 *   POST /api/votes/paid/verify
 *
 * Tests route handler validation and response contract.
 * Service functions are mocked — no database required.
 *
 * Protected sources:
 *   frontend-web/app/api/votes/paid/initiate/route.ts  (DO NOT EDIT)
 *   frontend-web/app/api/votes/paid/verify/route.ts    (DO NOT EDIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth, makeInitiateResult, makeVerifyResult, makeSupabaseMock } from './_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────

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
  verifyAndCreditPaidVote: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST as initiatePost } from '../../../app/api/votes/paid/initiate/route';
import { POST as verifyPost } from '../../../app/api/votes/paid/verify/route';
import { initiatePaidVote, verifyAndCreditPaidVote } from '@/src/server/voting/paid-vote.service';
import { createClient } from '@/lib/supabase/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeVerifyBody(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'tx-001',
    paymentReference: 'PAY_ref_abc123',
    ...overrides,
  };
}

// ── Tests: initiate ───────────────────────────────────────────────────────────

describe('POST /api/votes/paid/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
  });

  it('should return payment authorization URL when all fields present', async () => {
    vi.mocked(initiatePaidVote).mockResolvedValue(makeInitiateResult() as any);

    const res = await initiatePost(makeRequest('/api/votes/paid/initiate', { body: makeInitiateBody() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/abc123');
    expect(body.transactionId).toBe('tx-001');
    expect(body.amountExpected).toBe(50000); // kobo
    expect(body.votesToCredit).toBe(10);
  });

  it('should accept customVoteQuantity in place of packageId', async () => {
    vi.mocked(initiatePaidVote).mockResolvedValue(makeInitiateResult({ packageId: null }) as any);

    const body = makeInitiateBody({ packageId: undefined, customVoteQuantity: 5 });
    const res = await initiatePost(makeRequest('/api/votes/paid/initiate', { body }));

    expect(res.status).toBe(200);
    expect(vi.mocked(initiatePaidVote)).toHaveBeenCalledOnce();
  });

  it('should return 400 when contestId is missing', async () => {
    const res = await initiatePost(
      makeRequest('/api/votes/paid/initiate', { body: makeInitiateBody({ contestId: undefined }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/contestId/i);
  });

  it('should return 400 when voterEmail is missing', async () => {
    const res = await initiatePost(
      makeRequest('/api/votes/paid/initiate', { body: makeInitiateBody({ voterEmail: undefined }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/voterEmail/i);
  });

  it('should return 400 when voterName is missing', async () => {
    const res = await initiatePost(
      makeRequest('/api/votes/paid/initiate', { body: makeInitiateBody({ voterName: undefined }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/voterName/i);
  });

  it('should return 400 when neither packageId nor customVoteQuantity is provided', async () => {
    const res = await initiatePost(
      makeRequest('/api/votes/paid/initiate', {
        body: makeInitiateBody({ packageId: undefined, customVoteQuantity: undefined }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/packageId|customVoteQuantity/i);
  });
});

// ── Tests: verify ─────────────────────────────────────────────────────────────

describe('POST /api/votes/paid/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
  });

  it('should credit votes and return receipt on successful payment', async () => {
    vi.mocked(verifyAndCreditPaidVote).mockResolvedValue(makeVerifyResult() as any);

    const res = await verifyPost(makeRequest('/api/votes/paid/verify', { body: makeVerifyBody() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alreadyProcessed).toBe(false);
    expect(body.votesCredited).toBe(10);
    expect(body.receiptNumber).toMatch(/^RCP-/);
  });

  it('should be idempotent — return 200 with alreadyProcessed:true on duplicate', async () => {
    vi.mocked(verifyAndCreditPaidVote).mockResolvedValue(
      makeVerifyResult({ alreadyProcessed: true, votesCredited: 10 }) as any,
    );

    const res = await verifyPost(makeRequest('/api/votes/paid/verify', { body: makeVerifyBody() }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alreadyProcessed).toBe(true);
    expect(body.votesCredited).toBe(10); // still reports count, does NOT double-credit
  });

  it('should return 400 when transactionId is missing', async () => {
    const res = await verifyPost(
      makeRequest('/api/votes/paid/verify', { body: makeVerifyBody({ transactionId: undefined }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/transactionId/i);
  });

  it('should return 400 when paymentReference is missing', async () => {
    const res = await verifyPost(
      makeRequest('/api/votes/paid/verify', { body: makeVerifyBody({ paymentReference: undefined }) }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/paymentReference/i);
  });

  it('should propagate service errors with the correct status code', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');
    vi.mocked(verifyAndCreditPaidVote).mockRejectedValue(
      new ApiError('Payment was not successful', 402),
    );

    const res = await verifyPost(makeRequest('/api/votes/paid/verify', { body: makeVerifyBody() }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/payment was not successful/i);
  });
});
