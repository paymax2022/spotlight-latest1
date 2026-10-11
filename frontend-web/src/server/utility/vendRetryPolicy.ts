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
