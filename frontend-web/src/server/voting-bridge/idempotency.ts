/**
 * Idempotency key management for bridge vote operations
 * Prevents duplicate votes from concurrent requests
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/src/lib/api/responses';

/**
 * How long a duplicate waits for the in-flight original to publish its result.
 * The window only has to cover a normal vote round-trip: the race being closed
 * is a double-click or a retry storm, measured in milliseconds.
 */
const CLAIM_WAIT_ATTEMPTS = 10;
const CLAIM_WAIT_INTERVAL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an idempotency key has already been claimed and return cached result
 */
export async function checkAndClaimIdempotencyKey(key: string) {
  const supabase = createAdminClient();

  try {
    // Try to insert the key with an empty response
    // If it already exists, return the existing result
    const { data, error } = await supabase
      .from('bridge_idempotency_keys')
      .insert({
        key,
        response: {},
      })
      .select('response')
      .single();

    if (error) {
      // Key already exists — someone else claimed it.
      if (error.code === '23505') {
        // The winner publishes its response only AFTER the vote completes, so a
        // duplicate arriving concurrently used to read the placeholder `{}`, fall
        // through to `return null`, and cast a SECOND vote. The dedupe was real
        // for sequential retries and absent for concurrent ones — exactly the
        // case an idempotency key exists to cover. Wait for the winner instead.
        for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt++) {
          const { data: existing } = await supabase
            .from('bridge_idempotency_keys')
            .select('response')
            .eq('key', key)
            .single();

          if (existing && existing.response && Object.keys(existing.response).length > 0) {
            return existing.response;
          }
          await sleep(CLAIM_WAIT_INTERVAL_MS);
        }

        // Still nothing: the original is wedged or died before publishing. Refuse
        // rather than proceed — proceeding is precisely the double-vote this
        // guards. This is recoverable: a fresh submission mints a new key (see
        // VoteModal), so only a retry reusing THIS key is refused.
        throw new ApiError(
          'This vote is already being processed. Please try again.',
          409,
        );
      }
      // Some other insert error — don't block the request.
      return null;
    }

    // Key was inserted successfully — continue to call the function
    return null;
  } catch (error) {
    // The 409 above is a DECISION, not a failure. This catch's fail-open policy
    // (below) would swallow it back into `return null` and let the duplicate
    // vote — reinstating the exact hole the wait closes. Let it through.
    if (error instanceof ApiError) throw error;
    console.error('[Idempotency] checkAndClaimIdempotencyKey error:', error);
    // On unexpected error, don't block the request — allow it to proceed
    return null;
  }
}

/**
 * Release a claim whose operation failed, so a retry with the same key can
 * re-attempt.
 *
 * The claim row is inserted BEFORE the vote and only filled in afterwards, so a
 * failed attempt otherwise leaves a row holding the empty placeholder forever.
 * Paired with the wait-then-409 guard in checkAndClaimIdempotencyKey that would
 * then refuse every retry of that key permanently, turning one transient
 * failure into a key the voter can never use again. Only the caller that OWNS
 * the claim may release it — releasing someone else's would hand a concurrent
 * duplicate a second vote.
 */
export async function releaseIdempotencyKey(key: string) {
  const supabase = createAdminClient();

  try {
    await supabase.from('bridge_idempotency_keys').delete().eq('key', key);
  } catch (error) {
    // Best-effort: the key expires on its own (see cleanupExpiredKeys), and a
    // failed release must never mask the original error.
    console.error('[Idempotency] releaseIdempotencyKey error:', error);
  }
}

/**
 * Store the result of a vote operation against an idempotency key
 */
export async function storeIdempotencyResult(key: string, result: any) {
  const supabase = createAdminClient();

  try {
    await supabase
      .from('bridge_idempotency_keys')
      .update({ response: result })
      .eq('key', key);
  } catch (error) {
    console.error('[Idempotency] storeIdempotencyResult error:', error);
    // Non-blocking — don't fail the vote if we can't store the result
  }
}

/**
 * Clean up expired idempotency keys (runs periodically)
 * TTL: 24 hours
 */
export async function cleanupExpiredKeys() {
  const supabase = createAdminClient();

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await supabase
      .from('bridge_idempotency_keys')
      .delete()
      .lt('created_at', cutoff.toISOString());
  } catch (error) {
    console.error('[Idempotency] cleanupExpiredKeys error:', error);
  }
}
