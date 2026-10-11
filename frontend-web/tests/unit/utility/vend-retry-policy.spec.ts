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
  buildVendRetryMeta,
  unresolvedAttempts,
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

describe('buildVendRetryMeta', () => {
  const NOW = '2026-10-12T10:00:00.000Z';

  it('a writer-confirmed failure starts the clock now and counts the attempt it just made', () => {
    const m = buildVendRetryMeta({ basis: 'provider_failed', reason: 'declined', nowIso: NOW });
    expect(m).toMatchObject({ state: 'retrying', first_failed_at: NOW, attempts: 1, last_attempt_at: NOW, basis: 'provider_failed' });
  });

  it('a sweeper window starts with attempts 0 but waits one gap before the first retry', () => {
    const m = buildVendRetryMeta({ basis: 'stuck_recovery', reason: 'stuck', nowIso: NOW });
    expect(m.attempts).toBe(0);
    expect(m.last_attempt_at).toBe(NOW);
    expect(decideVendRetryAction({ ...base, meta: m, nowMs: Date.parse(NOW) + VEND_RETRY_GAP_MS - 1 })).toBe('wait');
    expect(decideVendRetryAction({ ...base, meta: m, nowMs: Date.parse(NOW) + VEND_RETRY_GAP_MS })).toBe('retry');
  });

  it('a re-failure keeps the ORIGINAL clock and attempts — the 30 minutes never restart', () => {
    const first = '2026-10-12T09:00:00.000Z';
    const m = buildVendRetryMeta({
      basis: 'stuck_recovery', reason: 'again', nowIso: NOW,
      existing: { state: 'retrying', first_failed_at: first, attempts: 4 },
    });
    expect(m.first_failed_at).toBe(first);
    expect(m.attempts).toBe(4);
  });

  it('an unreadable prior clock is not trusted: the window restarts rather than refunding at once', () => {
    const m = buildVendRetryMeta({ basis: 'stuck_recovery', reason: 'x', nowIso: NOW, existing: { first_failed_at: 'garbage', attempts: 9 } });
    expect(m.first_failed_at).toBe(NOW);
  });

  it('records which attempts an authoritative provider verdict resolved', () => {
    expect(buildVendRetryMeta({ basis: 'stuck_recovery', reason: 'x', nowIso: NOW, resolvedThrough: 3 }).ambiguity_resolved_through).toBe(3);
    expect(buildVendRetryMeta({ basis: 'stuck_recovery', reason: 'x', nowIso: NOW }).ambiguity_resolved_through).toBeUndefined();
  });
});

describe('unresolvedAttempts', () => {
  const attempts = [{ attempt_number: 1 }, { attempt_number: 2 }, { attempt_number: 3 }];
  it('without a verdict every attempt counts', () => {
    expect(unresolvedAttempts(attempts, {})).toHaveLength(3);
  });
  it('a verdict resolves the attempts up to it and no later ones', () => {
    expect(unresolvedAttempts(attempts, { ambiguity_resolved_through: 2 }).map((a) => a.attempt_number)).toEqual([3]);
    expect(unresolvedAttempts(attempts, { ambiguity_resolved_through: 3 })).toHaveLength(0);
  });
});
