/**
 * AUD-FE-007: the Paystack browser redirect carries `reference`/`trxref` —
 * never our internal vote_transactions.id — so /vote-callback used to POST a
 * blank transactionId to a verify route that required it. Every paid-vote
 * buyer saw "Payment Not Confirmed". The bridge now resolves the id from
 * payment_reference (unique on vote_transactions) before either the flag-on
 * path or the protected legacy function runs.
 *
 * These pin: (a) a reference-only request still reaches the atomic credit RPC
 * with the RESOLVED id, (b) an unresolvable reference is a clean 404, and
 * (c) a caller that has the real id never pays for the extra lookup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bridgedVerifyPaidVote } from '@/server/voting-bridge/bridge';
import { createAdminClient } from '@/lib/supabase/admin';
import { enableBridge, disableBridge } from '@/server/voting-bridge/feature-flag';

vi.mock('@/lib/supabase/admin');
vi.mock('@/server/voting-bridge/outbox', () => ({ enqueueOutboxEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/server/voting/core', () => ({
  verifyVotePayment: vi.fn(),
  recordVoteFraudSignals: vi.fn().mockResolvedValue({ signals: [], score: 0 }),
  recordVoteAudit: vi.fn().mockResolvedValue(undefined),
}));

import { verifyVotePayment } from '@/src/server/voting/core';

const CTX = { ipAddress: '203.0.113.42', userAgent: 'Mozilla/5.0 (Test)' };
const RESOLVED_ID = 'tx-resolved-uuid';
const PAY_REF = 'pay-ref-789';

const txRow = {
  id: RESOLVED_ID,
  contest_id: 'contest-1',
  contestant_id: 'contestant-2',
  voter_user_id: 'user-123',
  payment_reference: PAY_REF,
  amount_expected: '10.00',
  votes_purchased: 10,
  bonus_votes: 0,
  total_votes_to_credit: 10,
  payment_status: 'pending',
  vote_credit_status: 'pending',
};

const creditedRpc = {
  already_credited: false,
  reference_mismatch: false,
  vote_id: 'vote-1',
  contest_id: 'contest-1',
  contestant_id: 'contestant-2',
  voter_user_id: 'user-123',
  votes_purchased: 10,
  bonus_votes: 0,
  total_votes_to_credit: 10,
};

function mockSupabase(opts: { lookupRow: unknown; rpcResult?: unknown }) {
  const eqCalls: string[] = [];
  const supabase = {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockImplementation((cols: string) => ({
        eq: vi.fn().mockImplementation((col: string) => {
          eqCalls.push(col);
          return {
            maybeSingle: vi.fn().mockResolvedValue({
              // select('id') is the reference→id resolution; select('*') is the
              // flag-on path's full transaction fetch.
              data: cols === 'id' ? opts.lookupRow : txRow,
              error: null,
            }),
            // both chains must also survive an update().eq() shape
            update: undefined,
          };
        }),
      })),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: opts.rpcResult ? [opts.rpcResult] : null, error: null }),
  };
  (createAdminClient as any).mockReturnValue(supabase);
  return { supabase, eqCalls };
}

describe('AUD-FE-007 — verify resolves transactionId from payment_reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableBridge();
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 1000,
      currency: 'NGN',
      providerReference: 'prov-ref',
      paidAt: '2026-09-16T00:00:00Z',
      customerEmail: 'voter@example.com',
      raw: {} as any,
    });
  });

  afterEach(() => disableBridge());

  it('reference-only request resolves the id and credits via the atomic RPC', async () => {
    const { supabase } = mockSupabase({ lookupRow: { id: RESOLVED_ID }, rpcResult: creditedRpc });

    const result = await bridgedVerifyPaidVote({ paymentReference: PAY_REF }, 'user-123', CTX);

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe(RESOLVED_ID);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'credit_paid_vote_transaction',
      expect.objectContaining({ p_transaction_id: RESOLVED_ID, p_payment_reference: PAY_REF }),
    );
  });

  it('unresolvable reference is a clean 404, not a credit attempt', async () => {
    const { supabase } = mockSupabase({ lookupRow: null });

    const result = await bridgedVerifyPaidVote({ paymentReference: 'no-such-ref' }, 'user-123', CTX);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(verifyVotePayment).not.toHaveBeenCalled();
  });

  it('a caller with the real id skips the reference lookup entirely', async () => {
    const { supabase, eqCalls } = mockSupabase({ lookupRow: null, rpcResult: creditedRpc });

    const result = await bridgedVerifyPaidVote(
      { transactionId: RESOLVED_ID, paymentReference: PAY_REF },
      'user-123',
      CTX,
    );

    expect(result.success).toBe(true);
    // The resolution lookup filters on payment_reference; its absence means
    // the caller's id went straight through.
    expect(eqCalls).not.toContain('payment_reference');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'credit_paid_vote_transaction',
      expect.objectContaining({ p_transaction_id: RESOLVED_ID }),
    );
  });
});
