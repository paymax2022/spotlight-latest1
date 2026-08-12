import axios from 'axios';

/**
 * Message for a failed money mutation.
 *
 * Three outcomes need distinct wording, because telling a user their money did
 * not move when we don't know that is how double-spends get started:
 *
 *  - 409: the server recognised the replayed Idempotency-Key. The original
 *    request succeeded, so this is NOT a failure — the caller should treat it
 *    as success rather than inviting another attempt.
 *  - timeout / network drop: the request may or may not have completed. Say so,
 *    and point the user at their history instead of at the retry button.
 *  - everything else: the server rejected it (tier limit, balance, validation)
 *    and nothing moved, so its message is safe to show verbatim.
 */
export function moneyErrorMessage(e: unknown): string {
  if (isDuplicateReplay(e)) {
    return 'This request was already completed. Check your history — you have not been charged twice.';
  }
  if (isAmbiguousOutcome(e)) {
    return "We lost connection before we could confirm this. Check your wallet history before trying again — it may have gone through.";
  }
  return e instanceof Error && e.message ? e.message : 'Please try again.';
}

/** True when the server deduped a replayed Idempotency-Key (HTTP 409). */
export function isDuplicateReplay(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 409;
}

/**
 * True when the request's fate is unknown: it timed out or the connection
 * dropped before any response arrived. A retry here risks a second debit unless
 * it carries the same Idempotency-Key.
 */
export function isAmbiguousOutcome(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  // No response at all => never reached the server, or reached it and we never
  // heard back. Only the latter is dangerous, and we cannot tell them apart.
  return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || !e.response;
}
