// Owner rule for card-paid utility bills (supersedes admin-approved refunds):
//   payment received, value NOT vended and confirmed not vended
//     -> a cron retries the vend;
//     -> 30 minutes after the vending first failed, refund to the user's wallet;
//     -> if the user has no active wallet, HOLD the funds with admin and email the
//        user to activate the wallet; release when it becomes active.
// This pins the pure decision. The worker that applies it is in
// vend-retry-worker.spec.ts.
import { describe, expect, it } from 'vitest';
import {
  VEND_REFUND_AFTER_MS,
  VEND_RETRY_GAP_MS,
  decideVendRetryAction,
  type VendRetryMeta,
} from '@/src/server/utility/vendRetryPolicy';

const T0 = Date.parse('2026-10-12T10:00:00.000Z');
const meta = (over: Partial<VendRetryMeta> = {}): VendRetryMeta => ({
  state: 'retrying',
  first_failed_at: new Date(T0).toISOString(),
  attempts: 1,
  last_attempt_at: new Date(T0).toISOString(),
  ...over,
});
const base = { ambiguousAttempts: false, canRetryVend: true, walletActive: true };
const at = (ms: number) => T0 + ms;

describe('decideVendRetryAction', () => {
  it('constants: refund after 30 minutes, retry gap shorter than that', () => {
    expect(VEND_REFUND_AFTER_MS).toBe(30 * 60_000);
    expect(VEND_RETRY_GAP_MS).toBeLessThan(VEND_REFUND_AFTER_MS);
  });

  it('inside the window and the gap has not elapsed: wait', () => {
    expect(decideVendRetryAction({ ...base, meta: meta(), nowMs: at(VEND_RETRY_GAP_MS - 1) })).toBe('wait');
  });

  it('inside the window and the gap elapsed: retry the vend', () => {
    expect(decideVendRetryAction({ ...base, meta: meta(), nowMs: at(VEND_RETRY_GAP_MS) })).toBe('retry');
  });

  it('never attempted since the failure: retry straight away', () => {
    const m = meta({ attempts: 0, last_attempt_at: undefined });
    expect(decideVendRetryAction({ ...base, meta: m, nowMs: at(1_000) })).toBe('retry');
  });

  it('cannot retry (no spend posted, nothing to vend with): wait for the 30 minutes, never retry', () => {
    expect(decideVendRetryAction({ ...base, canRetryVend: false, meta: meta(), nowMs: at(VEND_RETRY_GAP_MS * 2) })).toBe('wait');
  });

  it('exactly 30 minutes after the first failure: refund (active wallet)', () => {
    expect(decideVendRetryAction({ ...base, meta: meta(), nowMs: at(VEND_REFUND_AFTER_MS) })).toBe('refund');
  });

  it('one millisecond before 30 minutes: still not a refund', () => {
    expect(decideVendRetryAction({ ...base, meta: meta(), nowMs: at(VEND_REFUND_AFTER_MS - 1) })).not.toBe('refund');
  });

  it('30 minutes elapsed but no active wallet: HOLD the funds, do not credit', () => {
    expect(decideVendRetryAction({ ...base, walletActive: false, meta: meta(), nowMs: at(VEND_REFUND_AFTER_MS) })).toBe('hold');
  });

  it('a hold with the wallet still inactive stays held (no repeat hold, no credit)', () => {
    const m = meta({ state: 'held', held_at: new Date(at(VEND_REFUND_AFTER_MS)).toISOString() });
    expect(decideVendRetryAction({ ...base, walletActive: false, meta: m, nowMs: at(VEND_REFUND_AFTER_MS + 3_600_000) })).toBe('skip_held');
  });

  it('a hold whose wallet is now active is released as a refund', () => {
    const m = meta({ state: 'held', held_at: new Date(at(VEND_REFUND_AFTER_MS)).toISOString() });
    expect(decideVendRetryAction({ ...base, walletActive: true, meta: m, nowMs: at(VEND_REFUND_AFTER_MS + 3_600_000) })).toBe('refund');
  });

  it('ambiguous provider evidence (a vend may have happened): never retry, never refund — manual review', () => {
    for (const nowMs of [at(VEND_RETRY_GAP_MS), at(VEND_REFUND_AFTER_MS), at(VEND_REFUND_AFTER_MS * 3)]) {
      expect(decideVendRetryAction({ ...base, ambiguousAttempts: true, meta: meta(), nowMs })).toBe('manual_review');
    }
    const held = meta({ state: 'held' });
    expect(decideVendRetryAction({ ...base, ambiguousAttempts: true, meta: held, nowMs: at(VEND_REFUND_AFTER_MS) })).toBe('manual_review');
  });

  it('a corrupt first_failed_at fails closed to manual review (never an immediate refund)', () => {
    expect(decideVendRetryAction({ ...base, meta: meta({ first_failed_at: 'not-a-date' }), nowMs: at(VEND_REFUND_AFTER_MS) })).toBe('manual_review');
  });

  it('states that are already resolved are left alone', () => {
    for (const state of ['vended', 'refunded', 'manual_review'] as const) {
      expect(decideVendRetryAction({ ...base, meta: meta({ state }), nowMs: at(VEND_REFUND_AFTER_MS * 2) })).toBe('done');
    }
  });
});
