/**
 * Unit tests for the shared cross-cutting vote core (src/server/voting/core).
 *
 * All three vote engines (v1 general, v2 bridge, open-mic) delegate their
 * cross-cutting money-safety concerns here. These tests pin the three
 * invariants the core guarantees:
 *
 *   1. Idempotency  — a cache hit returns the cached success and never runs the
 *      `fresh` callback (no re-verify, no double-credit); a miss runs it once.
 *   2. Fraud        — recordVoteFraudSignals emits an amount-mismatch signal and
 *      a high-volume signal, and persists them to fraud_flags.
 *   3. Audit        — recordVoteAudit emits a consistently-shaped vote_audit_logs
 *      entry via the shared appendAuditLog, namespaced by domain.
 *
 * Hermetic: Supabase + the audit service are mocked. No DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Idempotency guard
// ---------------------------------------------------------------------------
describe('core/idempotency', () => {
  it('returns the cached value on a hit and never runs the fresh callback', async () => {
    const { withIdempotency } = await import('../../../src/server/voting/core/idempotency');

    const cachedSuccess = { success: true, votesCredited: 10 };
    const fresh = vi.fn().mockResolvedValue({ success: true, votesCredited: 999 });

    const out = await withIdempotency(
      'pay-ref-1',
      { lookupCached: async () => cachedSuccess },
      fresh,
    );

    expect(out.alreadyProcessed).toBe(true);
    expect(out.value).toEqual(cachedSuccess);
    expect(fresh).not.toHaveBeenCalled(); // no re-verify / no double-credit
  });

  it('runs the fresh callback exactly once on a miss', async () => {
    const { withIdempotency } = await import('../../../src/server/voting/core/idempotency');

    const fresh = vi.fn().mockResolvedValue({ success: true, votesCredited: 10 });

    const out = await withIdempotency(
      'pay-ref-2',
      { lookupCached: async () => null },
      fresh,
    );

    expect(out.alreadyProcessed).toBe(false);
    expect(out.value).toEqual({ success: true, votesCredited: 10 });
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('treats a claim race-loss as a cache hit (atomic claim returns cached value)', async () => {
    const { resolveIdempotency } = await import('../../../src/server/voting/core/idempotency');

    const racedValue = { success: true, votesCredited: 5 };
    const outcome = await resolveIdempotency('pay-ref-3', {
      lookupCached: async () => null, // initial read misses
      claim: async () => racedValue, // a concurrent caller already completed it
    });

    expect(outcome.status).toBe('cached');
    if (outcome.status === 'cached') expect(outcome.value).toEqual(racedValue);
  });

  it('proceeds fresh when both lookup and claim miss', async () => {
    const { resolveIdempotency } = await import('../../../src/server/voting/core/idempotency');

    const outcome = await resolveIdempotency('pay-ref-4', {
      lookupCached: async () => null,
      claim: async () => null,
    });

    expect(outcome.status).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// 2. Fraud signals
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { makeSupabaseMock } from '../golden-path/_fixtures';

describe('core/fraud — recordVoteFraudSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits an amount-mismatch signal when paid ≠ expected (kobo)', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const { recordVoteFraudSignals } = await import('../../../src/server/voting/core/fraud');

    const res = await recordVoteFraudSignals({
      domain: 'general',
      contestId: 'c1',
      contestantId: 'k1',
      votes: 1,
      amountExpectedKobo: 50_000,
      amountPaidKobo: 10_000, // underpaid
    });

    const mismatch = res.signals.find((s) => s.type === 'suspicious_payment');
    expect(mismatch).toBeDefined();
    expect(res.score).toBeGreaterThan(0);
    // Persisted to the shared fraud_flags ledger (fire-and-forget).
    await Promise.resolve();
    expect(mock.from).toHaveBeenCalledWith('fraud_flags');
    expect(insertFn).toHaveBeenCalled();
  });

  it('does NOT emit an amount-mismatch when paid == expected', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const { recordVoteFraudSignals } = await import('../../../src/server/voting/core/fraud');

    const res = await recordVoteFraudSignals({
      domain: 'open-mic',
      contestId: 'c1',
      contestantId: 'e1',
      votes: 1,
      amountExpectedKobo: 50_000,
      amountPaidKobo: 50_000,
    });

    expect(res.signals.find((s) => s.type === 'suspicious_payment')).toBeUndefined();
  });

  it('emits a high-volume signal above the per-contest threshold', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const { recordVoteFraudSignals } = await import('../../../src/server/voting/core/fraud');

    const res = await recordVoteFraudSignals({
      domain: 'open-mic',
      contestId: 'c1',
      contestantId: 'e1',
      votes: 400,
      highVolumeThreshold: 100,
      highVolumeHardThreshold: 300,
    });

    const spike = res.signals.find((s) => s.type === 'vote_spike');
    expect(spike).toBeDefined();
    expect(spike?.severity).toBe('high'); // 400 ≥ hard threshold
  });

  it('emits no signals for a clean, in-threshold paid vote', async () => {
    const { mock } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);
    const { recordVoteFraudSignals } = await import('../../../src/server/voting/core/fraud');

    const res = await recordVoteFraudSignals({
      domain: 'general',
      contestId: 'c1',
      contestantId: 'k1',
      votes: 5,
      amountExpectedKobo: 25_000,
      amountPaidKobo: 25_000,
      highVolumeThreshold: 100,
    });

    expect(res.signals).toHaveLength(0);
    expect(res.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Audit emission
// ---------------------------------------------------------------------------
vi.mock('../../../src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { appendAuditLog } from '../../../src/server/voting/audit.service';

describe('core/audit — recordVoteAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a domain-namespaced, consistently-shaped audit entry', async () => {
    const { recordVoteAudit } = await import('../../../src/server/voting/core/audit');

    await recordVoteAudit({
      domain: 'open-mic',
      action: 'vote_credited',
      actorId: 'user-1',
      entityId: 'entry-1',
      entityType: 'competition_entry',
      contestId: 'c1',
      contestantId: 'entry-1',
      paymentReference: 'ref-1',
      votes: 10,
      amountPaidKobo: 50_000,
      amountExpectedKobo: 50_000,
      fraudScore: 0,
    });

    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(appendAuditLog).mock.calls[0][0];
    expect(arg.action).toBe('open-mic:vote_credited'); // domain namespaced
    expect(arg.entityType).toBe('competition_entry');
    expect(arg.entityId).toBe('entry-1');
    expect(arg.newValue).toMatchObject({
      domain: 'open-mic',
      action: 'vote_credited',
      paymentReference: 'ref-1',
      votes: 10,
      amountPaidKobo: 50_000,
    });
  });

  it('swallows audit failures so the money path is never broken', async () => {
    vi.mocked(appendAuditLog).mockRejectedValueOnce(new Error('audit table down'));
    const { recordVoteAudit } = await import('../../../src/server/voting/core/audit');

    // Must resolve (not throw) even though the underlying append failed.
    await expect(
      recordVoteAudit({
        domain: 'general',
        action: 'vote_amount_mismatch',
        actorId: 'system',
        entityId: 'tx-1',
      }),
    ).resolves.toBeUndefined();
  });
});
