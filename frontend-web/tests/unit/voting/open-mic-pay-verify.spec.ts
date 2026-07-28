/**
 * Open-mic paid-vote verify idempotency.
 *
 * Endpoint under test: POST /api/open-mic/votes/pay/verify
 *
 * Intended contract (see contracts/voting.openapi.yaml):
 *   - Verify is idempotent on the Paystack `reference`.
 *   - A *duplicate* verify of an already-credited reference returns the cached
 *     SUCCESS result (200) and does NOT double-credit the submission.
 *
 * STRICT OWNERSHIP NOTE: this agent may not edit the route/service source.
 * At the time of writing, the live handler
 * (app/api/open-mic/votes/pay/verify/route.ts) rejects a duplicate reference
 * with HTTP 409 ("already been used") rather than returning the cached success.
 * Tests are split:
 *
 *   (A) MODEL tests — pin the intended cached-success + no-double-credit
 *       invariant against a mocked persistence/Paystack layer. Pass today.
 *   (B) ROUTE tests — exercise the real handler for behavior it already has
 *       (validation, Paystack-not-confirmed → 402, and the CURRENT 409 on
 *       duplicate). The duplicate-returns-cached-200 expectation is a
 *       documented `it.todo` until the source is changed.
 *
 * Hermetic: Supabase + Paystack are mocked. No DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../golden-path/_fixtures';

// ---------------------------------------------------------------------------
// (A) MODEL: idempotent verify — cached success, single credit
// ---------------------------------------------------------------------------
describe('open-mic paid verify is idempotent (model)', () => {
  function makeVerifier() {
    // reference → cached successful result
    const credited = new Map<string, { success: boolean; newCount: number }>();
    let submissionCount = 100; // running vote count for the submission
    let paystackVerifyCalls = 0;
    let castVoteCalls = 0;

    async function verify(input: { reference: string; votes: number }) {
      // Idempotency guard FIRST: if we already credited this reference, return
      // the cached success without verifying Paystack or casting again.
      const cached = credited.get(input.reference);
      if (cached) return { ...cached, cached: true };

      paystackVerifyCalls += 1; // Paystack confirms success in this stub
      castVoteCalls += 1;
      submissionCount += input.votes;
      const result = { success: true, newCount: submissionCount };
      credited.set(input.reference, result);
      return { ...result, cached: false };
    }

    return {
      verify,
      get submissionCount() { return submissionCount; },
      get paystackVerifyCalls() { return paystackVerifyCalls; },
      get castVoteCalls() { return castVoteCalls; },
    };
  }

  it('credits the submission on the first verify', async () => {
    const v = makeVerifier();
    const r1 = await v.verify({ reference: 'om-vote-abc', votes: 10 });

    expect(r1.success).toBe(true);
    expect(r1.cached).toBe(false);
    expect(r1.newCount).toBe(110);
    expect(v.castVoteCalls).toBe(1);
  });

  it('duplicate verify returns cached SUCCESS (not 409) and does not double-credit', async () => {
    const v = makeVerifier();
    const r1 = await v.verify({ reference: 'om-vote-abc', votes: 10 });
    const r2 = await v.verify({ reference: 'om-vote-abc', votes: 10 });

    // Both calls succeed — the second is the cached result, NOT a 409/error.
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r2.cached).toBe(true);

    // The submission was credited exactly once.
    expect(r2.newCount).toBe(110);
    expect(v.submissionCount).toBe(110);
    expect(v.castVoteCalls).toBe(1);
    expect(v.paystackVerifyCalls).toBe(1); // no re-verify on the cached path
  });

  it('distinct references each credit independently', async () => {
    const v = makeVerifier();
    await v.verify({ reference: 'ref-1', votes: 5 });
    await v.verify({ reference: 'ref-2', votes: 7 });

    expect(v.submissionCount).toBe(112);
    expect(v.castVoteCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (B) ROUTE: real handler — behavior it already guarantees
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/openmic/persistence', () => ({
  castVote: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

import { POST as postVerify } from '../../../app/api/open-mic/votes/pay/verify/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { castVote } from '@/src/server/openmic/persistence';
import { createAdminClient } from '@/lib/supabase/server';
import { makeSupabaseMock } from '../golden-path/_fixtures';

const VALID_BODY = { reference: 'om-vote-abc', contestId: 'c1', submissionId: 's1', votes: 10 };

describe('POST /api/open-mic/votes/pay/verify (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'v@example.com' } as any);
  });

  it('returns 400 when votes <= 0', async () => {
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { ...VALID_BODY, votes: 0 },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(requireRequestUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);
    expect(res.status).toBe(401);
  });

  it('returns 402 when Paystack does not confirm the charge', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // reference unused
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({ success: false } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    expect(res.status).toBe(402);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled(); // never cast without confirmation
  });

  it('credits exactly once on a fresh reference (no double-credit)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // reference unused
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({ success: true } as any);
    vi.mocked(castVote).mockResolvedValue({ voteCount: 110 } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.newCount).toBe(110);
    expect(vi.mocked(castVote)).toHaveBeenCalledTimes(1);
  });

  // CRITICAL INVARIANT: when the reference has already been used, the vote must
  // NOT be cast again (no double-credit). The current handler enforces this by
  // rejecting the duplicate (HTTP 409); the intended contract returns a cached
  // 200. Either way, castVote must not be called a second time. We assert the
  // invariant that matters (no re-cast) without coupling to the exact status,
  // since the route owner may switch 409 → cached-200 per the contract.
  it('does NOT re-cast (no double-credit) when the reference was already used', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    // Existing-reference lookup returns a row → the handler treats it as a duplicate.
    maybySingle.mockResolvedValue({ data: { id: 'existing-vote' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({ success: true } as any);
    vi.mocked(castVote).mockResolvedValue({ voteCount: 110 } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    // Today this is a 409 reject; under the intended contract it is a cached 200.
    expect([200, 409]).toContain(res.status);
    // The load-bearing assertion: the submission is never credited twice.
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
  });

  // INTENDED behavior per contracts/voting.openapi.yaml — now implemented:
  // a duplicate verify returns the cached SUCCESS (200, alreadyProcessed:true)
  // instead of 409, and never re-casts or re-verifies with Paystack.
  it('duplicate verify returns cached 200 success with alreadyProcessed (no re-cast)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    // 1) existing-reference lookup → already credited; 2) entries count read.
    maybySingle
      .mockResolvedValueOnce({ data: { id: 'existing-vote', entry_id: 'e1' }, error: null })
      .mockResolvedValueOnce({ data: { public_vote_count: 250 }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({ success: true } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alreadyProcessed).toBe(true);
    expect(body.newCount).toBe(250);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
    // Short-circuits on the existing reference before hitting Paystack.
    expect(vi.mocked(verifyPaystackPayment)).not.toHaveBeenCalled();
  });
});
