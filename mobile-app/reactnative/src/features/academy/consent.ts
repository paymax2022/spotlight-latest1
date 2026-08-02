// ── Academy child-safety spend gate (pure, fail-closed) ──────────────────────
// NDPR / SF-7: a minor may not purchase or redeem unless a guardian has recorded
// consent ('granted'). This is enforced on BOTH the mock and live client paths
// (defence in depth — the server is also authoritative). Pure so it is testable
// and shared by the rewards centre and the competition-rewards redeem.

import type { GuardianConsentState } from './types';

export interface SpendConsentState {
  isMinor: boolean;
  guardianConsent: GuardianConsentState;
}

/**
 * True when the spend/redeem must be blocked. Fail-closed: a minor is blocked
 * unless consent is exactly 'granted' (so 'pending' and even a stray
 * 'not_required' on a minor block). Non-minors are never blocked.
 */
export function isSpendBlocked(s: SpendConsentState): boolean {
  return s.isMinor && s.guardianConsent !== 'granted';
}

/** Throws a user-facing error when a minor-without-consent tries to spend. */
export function assertCanSpend(s: SpendConsentState): void {
  if (isSpendBlocked(s)) {
    throw new Error('Guardian consent required before purchases or redemptions.');
  }
}
