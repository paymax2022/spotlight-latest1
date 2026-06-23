import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

/**
 * Try to claim an idempotency key.
 *
 * Returns:
 *   - The cached response (non-empty JSON) if the key was already processed.
 *   - null if the key is new (we claimed it) or in-flight (another request
 *     claimed it but hasn't stored the result yet).
 *
 * Race behaviour: two concurrent requests with the same key will both try to
 * INSERT. One succeeds (claimer); the other gets 23505 and fetches the cached
 * response. If the claimer hasn't stored the result yet, the race-loser sees
 * {} and returns null — effectively both proceed. This window is narrow
 * (<100ms typical for castFreeVote) and acceptable for the bridge's goals.
 * The primary guard is human-speed retries (seconds apart), not microsecond races.
 */
export async function checkAndClaimIdempotencyKey(key: string): Promise<unknown | null> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('bridge_idempotency_keys')
    .insert({ key, response: {} });

  if (!error) {
    // Successfully claimed — caller proceeds with vote
    return null;
  }

  if (error.code === '23505') {
    // Key already exists — return cached response if the result is stored
    const { data: existing } = await supabase
      .from('bridge_idempotency_keys')
      .select('response')
      .eq('key', key)
      .maybeSingle();

    const response = existing?.response as Record<string, unknown> | null;
    if (response && Object.keys(response).length > 0) {
      return response;
    }
    // In-flight — caller proceeds (result not stored yet)
    return null;
  }

  throw new ApiError('Idempotency key check failed', 500);
}

/**
 * Store the result of a completed vote against its idempotency key.
 * Called after the vote service succeeds — never on failure.
 * Failed calls must NOT be cached (the client can retry with the same key).
 */
export async function storeIdempotencyResult(key: string, result: unknown): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('bridge_idempotency_keys')
    .update({ response: result })
    .eq('key', key);
}
