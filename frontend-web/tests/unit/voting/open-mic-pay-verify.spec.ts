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

// (A) MODEL: idempotent verify — cached success, single credit
describe('open-mic paid verify is idempotent (model)', () => {
  function makeVerifier() {
    // reference → cached successful result
    const credited = new Map<string, { success: boolean; newCount: number }>();
    let submissionCount = 100; // running vote count for the submission
    let paystackVerifyCalls = 0;
    let castVoteCalls = 0;

    async function verify(input: { reference: string; votes: number }) {
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

// (B) ROUTE: real handler — behavior it already guarantees

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/openmic/persistence', () => ({
  castVote: vi.fn(),
  getContestById: vi.fn(),
}));

vi.mock('@/src/server/payments/openmic-vote-intents', () => ({
  getOpenMicVoteIntentByReference: vi.fn(async () => null),
  markOpenMicVoteIntent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

import { POST as postVerify } from '../../../app/api/open-mic/votes/pay/verify/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { castVote, getContestById } from '@/src/server/openmic/persistence';
import {
  getOpenMicVoteIntentByReference,
  markOpenMicVoteIntent,
} from '@/src/server/payments/openmic-vote-intents';
import { createAdminClient } from '@/lib/supabase/server';
import { makeSupabaseMock } from '../golden-path/_fixtures';

// contests.id / competition_entries.id are uuid columns; the route shape-checks
// resolved ids before any store read, so fixtures must be real uuids.
const VALID_BODY = {
  reference: 'om-vote-abc',
  contestId: '11111111-1111-1111-1111-111111111111',
  submissionId: '22222222-2222-2222-2222-222222222222',
  votes: 10,
};

describe('POST /api/open-mic/votes/pay/verify (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 'v@example.com' } as any);
    vi.mocked(getOpenMicVoteIntentByReference).mockResolvedValue(null);
    // Server-side quote: ₦50/vote → 10 votes = 500,000 kobo expected.
    vi.mocked(getContestById).mockResolvedValue({
      votingConfig: { votePrice: 50 },
    } as any);
  });

  it('returns 400 when votes <= 0', async () => {
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { ...VALID_BODY, votes: 0 },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(400);
  });

  // Malformed-id gate: non-uuid ids fed into the uuid contest/entry columns
  // surfaced as a Postgres 22P02 → 500 on prod. The route must refuse with a
  // 400 before the first store read (no intent → body ids are authoritative).
  it('returns 400 on a non-uuid contestId (no intent)', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { ...VALID_BODY, contestId: 'bogus' },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(400);
    expect(vi.mocked(getContestById)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyPaystackPayment)).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-uuid submissionId (no intent)', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { ...VALID_BODY, submissionId: 'bogus' },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(400);
    expect(vi.mocked(getContestById)).not.toHaveBeenCalled();
  });

  it('returns 400 on fractional votes', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { ...VALID_BODY, votes: 1.5 },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(400);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
  });

  // The intent's frozen ids are authoritative: malformed body ids don't 400 a
  // verify whose reference has a recorded intent with valid uuids.
  it('lets a recorded intent override malformed body ids', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(getOpenMicVoteIntentByReference).mockResolvedValue({
      reference: 'om-vote-abc',
      contest_id: '33333333-3333-3333-3333-333333333333',
      submission_id: '44444444-4444-4444-4444-444444444444',
      voter_user_id: 'user-1',
      votes: 7,
      amount_kobo: 350_000,
      stage_name: null,
      status: 'pending',
    } as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 350_000,
    } as any);
    vi.mocked(castVote).mockResolvedValue({ voteCount: 42 } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { reference: 'om-vote-abc', contestId: 'bogus', submissionId: 'bogus', votes: 1 },
    });
    const res = await postVerify(req);
    expect(res.status).toBe(200);
    expect(vi.mocked(castVote)).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: '33333333-3333-3333-3333-333333333333',
        submissionId: '44444444-4444-4444-4444-444444444444',
      }),
    );
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

  // AUD-FE-009: Paystack-confirmed amount must cover the server-side quote —
  // a charge collected below vote_price_ngn × votes must not mint votes.
  it('rejects (402) when Paystack collected less than the server-side quote', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // reference unused
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 1, // paid 1 kobo for 10 votes at ₦50/vote
    } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    expect(res.status).toBe(402);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
  });

  it('casts when the confirmed amount covers the quote', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 500_000,
    } as any);
    vi.mocked(castVote).mockResolvedValue({ voteCount: 110 } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(castVote)).toHaveBeenCalledWith(
      expect.objectContaining({ votes: 10, paymentReference: 'om-vote-abc' }),
    );
  });

  // AUD-FE-003 residual: an initiate-recorded intent is authoritative — frozen
  // params beat the request body, another user's reference cannot be claimed,
  // and the intent is marked confirmed after the cast.
  it('uses the frozen intent params and marks the intent confirmed', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(getOpenMicVoteIntentByReference).mockResolvedValue({
      reference: 'om-vote-abc',
      contest_id: '33333333-3333-3333-3333-333333333333',
      submission_id: '44444444-4444-4444-4444-444444444444',
      voter_user_id: 'user-1',
      votes: 7,
      amount_kobo: 350_000,
      stage_name: null,
      status: 'pending',
    } as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 350_000,
    } as any);
    vi.mocked(castVote).mockResolvedValue({ voteCount: 42 } as any);

    // Client lies about the params — the intent's frozen values must win.
    const req = makeRequest('/api/open-mic/votes/pay/verify', {
      body: { reference: 'om-vote-abc', contestId: VALID_BODY.contestId, submissionId: VALID_BODY.submissionId, votes: 10 },
    });
    const res = await postVerify(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(castVote)).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: '33333333-3333-3333-3333-333333333333',
        submissionId: '44444444-4444-4444-4444-444444444444',
        votes: 7,
      }),
    );
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith('om-vote-abc', 'confirmed');
  });

  it('rejects a reference initiated by a different user', async () => {
    vi.mocked(getOpenMicVoteIntentByReference).mockResolvedValue({
      reference: 'om-vote-abc',
      contest_id: VALID_BODY.contestId,
      submission_id: VALID_BODY.submissionId,
      voter_user_id: 'someone-else',
      votes: 10,
      amount_kobo: 500_000,
      stage_name: null,
      status: 'pending',
    } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    expect(res.status).toBe(403);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyPaystackPayment)).not.toHaveBeenCalled();
  });

  it('marks the intent amount_mismatch on under-collection', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    vi.mocked(getOpenMicVoteIntentByReference).mockResolvedValue({
      reference: 'om-vote-abc',
      contest_id: VALID_BODY.contestId,
      submission_id: VALID_BODY.submissionId,
      voter_user_id: 'user-1',
      votes: 10,
      amount_kobo: 500_000,
      stage_name: null,
      status: 'pending',
    } as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 5,
    } as any);

    const req = makeRequest('/api/open-mic/votes/pay/verify', { body: VALID_BODY });
    const res = await postVerify(req);

    expect(res.status).toBe(402);
    expect(vi.mocked(castVote)).not.toHaveBeenCalled();
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith(
      'om-vote-abc',
      'amount_mismatch',
      expect.stringContaining('5 kobo'),
    );
  });
});
