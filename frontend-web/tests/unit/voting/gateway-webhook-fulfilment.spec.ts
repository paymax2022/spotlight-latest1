/**
 * AUD-FE-003 — gateway-charge webhook fulfilment.
 *
 * paymax_gateway charges were previously only verified + logged; fulfilment
 * depended entirely on the client's success callback. The handler now settles
 * a matching vote_transactions row server-side via the bridge, so a
 * crash/backgrounded client no longer strands a verified payment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseState = vi.hoisted(() => ({
  voteTx: null as { id: string; vote_credit_status: string } | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'vote_transactions') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: supabaseState.voteTx, error: null }) }),
          }),
        };
      }
      if (table === 'payment_webhook_logs') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          }),
          upsert: () => ({ select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }) }),
          update: (u: Record<string, unknown>) => {
            supabaseState.updates.push(u);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackWebhookSignature: vi.fn(() => true),
  verifyPaystackPayment: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedVerifyPaidVote: vi.fn(async () => ({ success: true, voteId: 'v1', totalVotes: 10 })),
}));

// The handler now also claims charge.success events with a pending
// registration_payment_intents row (AUD-FE-003 residual). None match in this
// spec — the vote-domain assertions are unchanged.
vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationPaymentIntentByReference: vi.fn(async () => null),
  applyRegistrationPaymentSuccess: vi.fn(async () => ({})),
  markRegistrationPaymentIntentStatus: vi.fn(async () => ({})),
}));

// Same residual intent probes for open-mic votes and academy fees — both
// return no-match here; only vote_transactions fulfilment is under test.
vi.mock('@/src/server/payments/openmic-vote-intents', () => ({
  getOpenMicVoteIntentByReference: vi.fn(async () => null),
}));
vi.mock('@/src/server/payments/academy-fee-intents', () => ({
  getAcademyFeeIntentByReference: vi.fn(async () => null),
}));

import { handleGatewayPaystackWebhook } from '../../../app/api/webhooks/paystack/gateway-handler';
import { bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';

const charge = (reference = 'PAY_gw_1') =>
  JSON.stringify({
    event: 'charge.success',
    data: { reference, metadata: { purpose: 'paymax_gateway', domain: 'voting' } },
  });

describe('gateway webhook vote fulfilment (AUD-FE-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseState.voteTx = null;
    supabaseState.updates = [];
  });

  it('fulfils a pending vote transaction server-side', async () => {
    supabaseState.voteTx = { id: 'tx-9', vote_credit_status: 'pending' };
    const res = await handleGatewayPaystackWebhook(charge(), 'sig');
    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(bridgedVerifyPaidVote).toHaveBeenCalledWith(
      { transactionId: 'tx-9', paymentReference: 'PAY_gw_1' },
      'system:webhook',
      expect.objectContaining({ userAgent: 'paystack-webhook' }),
    );
    expect(supabaseState.updates.at(-1)).toMatchObject({ processed: true });
  });

  it('skips fulfilment when the transaction is already credited (idempotent)', async () => {
    supabaseState.voteTx = { id: 'tx-9', vote_credit_status: 'credited' };
    const res = await handleGatewayPaystackWebhook(charge(), 'sig');
    expect(res.processed).toBe(true);
    expect(bridgedVerifyPaidVote).not.toHaveBeenCalled();
  });

  it('records but does not fulfil when no vote transaction matches', async () => {
    const res = await handleGatewayPaystackWebhook(charge('PAY_other_domain'), 'sig');
    expect(res.processed).toBe(true);
    expect(bridgedVerifyPaidVote).not.toHaveBeenCalled();
  });

  it('surfaces fulfilment failure so the dispatcher 500s and Paystack retries', async () => {
    supabaseState.voteTx = { id: 'tx-9', vote_credit_status: 'pending' };
    vi.mocked(bridgedVerifyPaidVote).mockResolvedValueOnce({ success: false, error: 'amount mismatch' });
    const res = await handleGatewayPaystackWebhook(charge(), 'sig');
    expect(res).toMatchObject({ processed: false, error: 'amount mismatch' });
    expect(supabaseState.updates.at(-1)).toMatchObject({ processed: false });
  });
});
