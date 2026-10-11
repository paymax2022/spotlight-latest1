// Vend-retry policy for card-paid utility bills. Pure on purpose: every money
// decision the retry worker makes is this one function, so it can be pinned
// exhaustively without a database.
//
// Owner rule: payment received but the value was NOT vended and that is
// confirmed => a cron retries the vend; 30 minutes after the vending first failed
// the customer is refunded to their wallet; a customer with no active wallet has
// the funds HELD with admin and is emailed to activate it.

/** Refund once vending has been failing for this long. */
export const VEND_REFUND_AFTER_MS = 30 * 60 * 1000;

/** Minimum gap between two vend retries, so a flapping provider is not hammered. */
export const VEND_RETRY_GAP_MS = 5 * 60 * 1000;

export type VendRetryState = 'retrying' | 'held' | 'manual_review' | 'vended' | 'refunded';

/** Stored on `utility_transactions.metadata.vend_retry`. */
export interface VendRetryMeta {
  state: VendRetryState;
  /** When vending was first confirmed failed; the 30-minute clock starts here. */
  first_failed_at: string;
  attempts: number;
  last_attempt_at?: string;
  last_error?: string;
  held_at?: string;
  basis?: string;
  refunded_at?: string;
  refunded_by?: string;
  /** True when the refund was a release of a previously held one. */
  released?: boolean;
  /**
   * Provider attempts numbered <= this were resolved by an authoritative provider
   * verdict (a requery of a real provider_reference said "failed"), so a leftover
   * pending/timeout attempt among them no longer means "may have vended".
   */
  ambiguity_resolved_through?: number;
}

export type VendRetryAction =
  | 'retry'
  | 'wait'
  | 'refund'
  | 'hold'
  | 'skip_held'
  | 'manual_review'
  | 'done';

export function decideVendRetryAction(input: {
  meta: VendRetryMeta;
  nowMs: number;
  /** A provider attempt was ambiguous (timeout / error): the vend may have happened. */
  ambiguousAttempts: boolean;
  /** The spend leg is posted, so a retry has something to vend with. */
  canRetryVend: boolean;
  walletActive: boolean;
}): VendRetryAction {
  const { meta, nowMs } = input;
  if (meta.state !== 'retrying' && meta.state !== 'held') return 'done';

  // A vend that may have happened is never retried (double vend) and never
  // refunded (vend AND money back). A human reconciles it.
  if (input.ambiguousAttempts) return 'manual_review';

  if (meta.state === 'held') return input.walletActive ? 'refund' : 'skip_held';

  const firstFailed = Date.parse(meta.first_failed_at);
  if (!Number.isFinite(firstFailed)) return 'manual_review'; // fail closed: no clock, no refund
  if (nowMs - firstFailed >= VEND_REFUND_AFTER_MS) {
    return input.walletActive ? 'refund' : 'hold';
  }

  if (!input.canRetryVend) return 'wait';
  const last = meta.last_attempt_at ? Date.parse(meta.last_attempt_at) : NaN;
  if (!Number.isFinite(last) || nowMs - last >= VEND_RETRY_GAP_MS) return 'retry';
  return 'wait';
}

/** The provider attempts that still count as "may have vended". */
export function unresolvedAttempts<T extends { attempt_number: number }>(
  attempts: T[],
  meta: Pick<VendRetryMeta, 'ambiguity_resolved_through'>,
): T[] {
  const through = meta.ambiguity_resolved_through ?? 0;
  // An attempt whose number cannot be read is never treated as resolved.
  return attempts.filter((a) => !Number.isFinite(a.attempt_number) || a.attempt_number > through);
}

/**
 * Builds the marker that opens (or re-opens) the retry window.
 * - A re-failure keeps the ORIGINAL clock and attempt count: restarting the
 *   30 minutes on every requery verdict would delay the refund indefinitely.
 * - A stuck-sweeper window starts with last_attempt_at = now, so the first retry
 *   waits one gap: a writer that merely stalled can wake and vend first without a
 *   second vend racing it.
 */
export function buildVendRetryMeta(input: {
  basis: 'provider_failed' | 'stuck_recovery';
  reason: string;
  nowIso: string;
  existing?: Partial<VendRetryMeta> | null;
  resolvedThrough?: number;
}): VendRetryMeta {
  const prior = input.existing;
  const priorClock = prior?.first_failed_at && Number.isFinite(Date.parse(prior.first_failed_at)) ? prior.first_failed_at : undefined;
  return {
    state: 'retrying',
    first_failed_at: priorClock ?? input.nowIso,
    attempts: priorClock ? (prior?.attempts ?? 0) : input.basis === 'provider_failed' ? 1 : 0,
    last_attempt_at: input.nowIso,
    last_error: input.reason,
    basis: input.basis,
    ...(input.resolvedThrough !== undefined ? { ambiguity_resolved_through: input.resolvedThrough } : {}),
  };
}
