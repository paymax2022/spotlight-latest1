/**
 * Shared idempotency guard for ALL three vote engines.
 *
 * Every money-path verify in the platform (v1 general paid-vote, v2 bridge,
 * open-mic competition-entry) must be idempotent on its payment reference /
 * idempotency key: a duplicate verify returns the *cached success* and must
 * never double-credit.
 *
 * The three engines historically dedup'd in three different ways:
 *   - v1 paid-vote.service: re-reads vote_transactions.vote_credit_status.
 *   - v2 bridge: bridge_idempotency_keys table (claim/store pattern).
 *   - open-mic route: re-reads competition_entry_votes.payment_reference.
 *
 * Each domain keeps its own durable dedup anchor (those are the source of
 * truth and the tables are intentionally separate), but they now express the
 * SAME contract through this one helper so the semantics can never drift:
 *
 *   resolveIdempotency(key, { lookupCached, claim }) →
 *     - { status: 'cached', value }  → caller returns the cached success (200)
 *     - { status: 'fresh' }          → caller proceeds to verify + credit
 *
 * `lookupCached` reads the domain's source of truth and returns the cached
 * success result if the key was already processed, or null if not.
 * `claim` (optional) lets a domain atomically reserve the key to narrow the
 * concurrent-duplicate window (used by the v2 bridge's claim/store table).
 */

export type IdempotencyOutcome<T> =
  | { status: 'cached'; value: T }
  | { status: 'fresh' };

export interface IdempotencyAnchor<T> {
  /**
   * Read the domain's durable dedup anchor. Return the cached success result
   * if this key/reference was already processed, otherwise null.
   */
  lookupCached: (key: string) => Promise<T | null>;

  /**
   * OPTIONAL atomic claim. When provided, it is consulted after the initial
   * lookup misses: it should try to reserve the key and, if another caller
   * already reserved + completed it, return that cached value. Returning null
   * means "claimed (or in-flight) — proceed".
   */
  claim?: (key: string) => Promise<T | null>;
}

/**
 * Resolve the idempotency status for a verify call.
 *
 * Two reads, both fail-safe toward NOT double-crediting:
 *   1. lookupCached — if the durable anchor already has a success, return it.
 *   2. claim (if supplied) — atomically reserve; a race-loser gets the cached
 *      value back here. A null from either means the caller proceeds fresh.
 */
export async function resolveIdempotency<T>(
  key: string,
  anchor: IdempotencyAnchor<T>,
): Promise<IdempotencyOutcome<T>> {
  const cached = await anchor.lookupCached(key);
  if (cached !== null && cached !== undefined) {
    return { status: 'cached', value: cached };
  }

  if (anchor.claim) {
    const raced = await anchor.claim(key);
    if (raced !== null && raced !== undefined) {
      return { status: 'cached', value: raced };
    }
  }

  return { status: 'fresh' };
}

/**
 * Convenience wrapper: run the whole verify flow behind the guard.
 *
 *   const result = await withIdempotency(reference, anchor, async () => {
 *     // verify payment, credit votes, build the success payload
 *     return successPayload;
 *   });
 *
 * On a cached hit the `fresh` callback is NEVER invoked, so the payment is not
 * re-verified and the credit is not re-applied.
 */
export async function withIdempotency<T>(
  key: string,
  anchor: IdempotencyAnchor<T>,
  fresh: () => Promise<T>,
): Promise<{ value: T; alreadyProcessed: boolean }> {
  const outcome = await resolveIdempotency(key, anchor);
  if (outcome.status === 'cached') {
    return { value: outcome.value, alreadyProcessed: true };
  }
  const value = await fresh();
  return { value, alreadyProcessed: false };
}
