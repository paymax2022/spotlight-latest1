/**
 * Test: Paid Vote Concurrency (Webhook + Redirect Race) — PV-005
 *
 * The bridge's paid-vote credit is now a SINGLE atomic RPC
 * (credit_paid_vote_transaction) that locks the transaction row for the full
 * duration of the check-and-write, closing the TOCTOU window between a
 * webhook and a browser redirect racing to credit the same transaction.
 *
 * A mocked unit test CANNOT prove real Postgres row-locking — that's exactly
 * how the previous "fix" (a separate lock_vote_transaction RPC call, followed
 * by several more independent Supabase calls) shipped looking correct while
 * providing zero actual protection: each Supabase-js call is its own
 * PostgREST transaction, so a lock acquired in one call is released before
 * the next call even runs. The authoritative proof for PV-005 is a live,
 * truly-concurrent run of credit_paid_vote_transaction against a real
 * Postgres instance (20 concurrent calls -> exactly 1 credited, 19 safe
 * "already_credited" replays, verified via direct SQL — see
 * docs/qa/voting-contest-test-plan.md PV-005 for the recorded DB-executed
 * proof). These tests cover the bridge's OWN responsibilities: calling the
 * right RPC with the right arguments, handling each of its possible
 * responses correctly, and not double-firing side effects on a replay.
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

import { verifyVotePayment, recordVoteFraudSignals, recordVoteAudit } from '@/src/server/voting/core';

describe('Paid Vote Concurrency (Webhook + Redirect Race) — PV-005', () => {
  const req = { transactionId: 'tx-123-uuid', paymentReference: 'pay-ref-456-uuid' };
  const context = { ipAddress: '203.0.113.42', userAgent: 'Mozilla/5.0 (Test)' };

  const mockTransaction = {
    id: req.transactionId,
    contest_id: 'contest-1',
    contestant_id: 'contestant-2',
    voter_user_id: 'user-123',
    payment_reference: req.paymentReference,
    amount_expected: '10.00',
    votes_purchased: 10,
    bonus_votes: 0,
    total_votes_to_credit: 10,
    payment_status: 'pending',
    vote_credit_status: 'pending',
  };

  function mockSupabaseWith(opts: { txRow?: unknown; rpcResult?: unknown; rpcError?: unknown }) {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.txRow ?? mockTransaction, error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: opts.rpcResult ? [opts.rpcResult] : null, error: opts.rpcError ?? null }),
    };
    (createAdminClient as any).mockReturnValue(supabase);
    return supabase;
  }

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

  it('calls the atomic credit_paid_vote_transaction RPC, not a separate lock call', async () => {
    mockSupabaseWith({ rpcResult: { already_credited: false, reference_mismatch: false, vote_id: 'vote-1', contest_id: 'contest-1', contestant_id: 'contestant-2', voter_user_id: 'user-123', votes_purchased: 10, bonus_votes: 0, total_votes_to_credit: 10 } });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(true);
    expect(result.voteId).toBe('vote-1');
    const supabase = (createAdminClient as any)();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'credit_paid_vote_transaction',
      expect.objectContaining({ p_transaction_id: req.transactionId, p_payment_reference: req.paymentReference }),
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith('lock_vote_transaction', expect.anything());
  });

  it('a losing concurrent caller (already_credited=true) succeeds without double-crediting side effects', async () => {
    mockSupabaseWith({ rpcResult: { already_credited: true, reference_mismatch: false, vote_id: null, contest_id: 'contest-1', contestant_id: 'contestant-2', voter_user_id: 'user-123', votes_purchased: 10, bonus_votes: 0, total_votes_to_credit: 10 } });

    const result = await bridgedVerifyPaidVote(req, 'webhook-actor', context);

    // PV-005: the request that lost the race is a SAFE SUCCESS, not a failure —
    // the other caller already recorded the real credit event.
    expect(result.success).toBe(true);
    expect(result.voteId).toBeUndefined();
    // No second fraud/audit entry for a replay — only the winning call records these.
    expect(recordVoteFraudSignals).not.toHaveBeenCalled();
    expect(recordVoteAudit).not.toHaveBeenCalled();
  });

  it('the winning caller records fraud signals and audit exactly once', async () => {
    mockSupabaseWith({ rpcResult: { already_credited: false, reference_mismatch: false, vote_id: 'vote-1', contest_id: 'contest-1', contestant_id: 'contestant-2', voter_user_id: 'user-123', votes_purchased: 10, bonus_votes: 0, total_votes_to_credit: 10 } });

    await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(recordVoteFraudSignals).toHaveBeenCalledTimes(1);
    expect(recordVoteAudit).toHaveBeenCalledTimes(1);
    expect(recordVoteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'vote_credited', entityId: req.transactionId }));
  });

  it('rejects a reference mismatch reported by the atomic RPC', async () => {
    mockSupabaseWith({ rpcResult: { already_credited: false, reference_mismatch: true, vote_id: null, contest_id: 'contest-1', contestant_id: 'contestant-2', voter_user_id: 'user-123', votes_purchased: 10, bonus_votes: 0, total_votes_to_credit: 10 } });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('reference mismatch');
  });

  it('does not call the credit RPC at all if the transaction is already credited (fast idempotent path)', async () => {
    const supabase = mockSupabaseWith({ txRow: { ...mockTransaction, vote_credit_status: 'credited', vote_id: 'vote-1' } });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(verifyVotePayment).not.toHaveBeenCalled();
  });

  it('does not call the credit RPC if the gateway does not confirm the payment', async () => {
    const supabase = mockSupabaseWith({});
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: false,
      amountKobo: 0,
      currency: 'NGN',
      providerReference: null,
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('does not call the credit RPC on an amount mismatch, and records a fraud signal instead', async () => {
    const supabase = mockSupabaseWith({});
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 100, // far short of amount_expected (10.00 NGN = 1000 kobo)
      currency: 'NGN',
      providerReference: 'prov-ref',
      paidAt: '2026-09-16T00:00:00Z',
      customerEmail: 'voter@example.com',
      raw: {} as any,
    });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(recordVoteFraudSignals).toHaveBeenCalledTimes(1);
  });

  it('rejects when the request payment reference does not match the stored transaction', async () => {
    mockSupabaseWith({ txRow: { ...mockTransaction, payment_reference: 'a-totally-different-reference' } });

    const result = await bridgedVerifyPaidVote(req, 'user-123', context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
  });
});
