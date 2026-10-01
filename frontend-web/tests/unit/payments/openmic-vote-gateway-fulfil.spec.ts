/**
 * AUD-FE-003 residual / AUD-FE-009 — Open Mic paid-vote fulfilment through the
 * shared gateway path.
 *
 * fulfilVerifiedGatewayCharge is what the Paystack webhook handler and
 * POST /api/v1/payments/gateway/recover both run once Paystack confirms the
 * charge. These specs pin the Open Mic arm:
 *   - a pending openmic_vote_paystack_intents row is cast with its FROZEN
 *     params (not the request body, not the webhook payload),
 *   - the charge must cover the server-quoted amount_kobo — under-collection
 *     terminates the intent as amount_mismatch rather than minting votes,
 *   - the competition_entry_votes.payment_reference row remains the dedup
 *     anchor: an already-cast reference is a confirmed no-op, and a raced
 *     insert is recovered, never retried into a duplicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedVerifyPaidVote: vi.fn(),
}));

vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationPaymentIntentByReference: vi.fn(async () => null),
  applyRegistrationPaymentSuccess: vi.fn(),
  markRegistrationPaymentIntentStatus: vi.fn(),
}));

vi.mock('@/src/server/payments/openmic-vote-intents', () => ({
  getOpenMicVoteIntentByReference: vi.fn(async () => null),
  markOpenMicVoteIntent: vi.fn(async () => undefined),
}));

vi.mock('@/src/server/openmic/persistence', () => ({
  castVote: vi.fn(),
}));

import { fulfilVerifiedGatewayCharge } from '@/src/server/payments/gateway-fulfil';
import { createAdminClient } from '@/lib/supabase/server';
import { castVote } from '@/src/server/openmic/persistence';
import { markOpenMicVoteIntent } from '@/src/server/payments/openmic-vote-intents';

const PENDING_INTENT = {
  reference: 'om-vote-ref-1',
  contest_id: 'contest-1',
  submission_id: 'entry-1',
  voter_user_id: 'voter-1',
  votes: 7,
  amount_kobo: 350_000,
  stage_name: null,
  status: 'pending' as const,
};

const call = (intent: unknown, verifiedAmountKobo = 350_000) =>
  fulfilVerifiedGatewayCharge('om-vote-ref-1', verifiedAmountKobo, {
    voteTransaction: null,
    registrationIntent: null,
    openmicIntent: intent as never,
  });

describe('fulfilVerifiedGatewayCharge — open-mic vote arm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
  });

  it('casts with the intent\u2019s frozen params and marks the intent confirmed', async () => {
    const outcome = await call(PENDING_INTENT);

    expect(outcome).toEqual({ fulfilled: ['open_mic_vote'] });
    expect(castVote).toHaveBeenCalledWith({
      contestId: 'contest-1',
      submissionId: 'entry-1',
      voterUserId: 'voter-1',
      source: 'paid',
      votes: 7,
      paymentReference: 'om-vote-ref-1',
    });
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith('om-vote-ref-1', 'confirmed');
  });

  it('terminates as amount_mismatch when Paystack under-collected — no cast, no error', async () => {
    const outcome = await call(PENDING_INTENT, 100);

    expect(outcome).toEqual({ fulfilled: [] });
    expect(castVote).not.toHaveBeenCalled();
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith(
      'om-vote-ref-1',
      'amount_mismatch',
      expect.stringContaining('100 kobo'),
    );
  });

  it('is a no-op cast when the reference is already credited (verify won the race)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: { id: 'existing' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    const outcome = await call(PENDING_INTENT);

    expect(outcome).toEqual({ fulfilled: ['open_mic_vote'] });
    expect(castVote).not.toHaveBeenCalled();
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith('om-vote-ref-1', 'confirmed');
  });

  it('returns a retryable error when castVote fails and no vote landed', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // pre-check: nothing cast
      .mockResolvedValueOnce({ data: null, error: null }); // post-failure re-check: still nothing
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(castVote).mockRejectedValueOnce(new Error('db write failed'));

    const outcome = await call(PENDING_INTENT);

    expect(outcome.error).toBe('db write failed');
    expect(markOpenMicVoteIntent).not.toHaveBeenCalledWith('om-vote-ref-1', 'confirmed');
  });

  it('recovers a raced insert as already-processed rather than erroring', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null }) // pre-check
      .mockResolvedValueOnce({ data: { id: 'raced' }, error: null }); // re-check: verify won
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    vi.mocked(castVote).mockRejectedValueOnce(new Error('duplicate key'));

    const outcome = await call(PENDING_INTENT);

    expect(outcome).toEqual({ fulfilled: ['open_mic_vote'] });
    expect(markOpenMicVoteIntent).toHaveBeenCalledWith('om-vote-ref-1', 'confirmed');
  });

  it('skips an intent that is no longer pending', async () => {
    const outcome = await call({ ...PENDING_INTENT, status: 'confirmed' });

    expect(outcome).toEqual({ fulfilled: [] });
    expect(castVote).not.toHaveBeenCalled();
  });
});
