/**
 * Idempotency key management for bridge vote operations
 * Prevents duplicate votes from concurrent requests
 */

import { createAdminClient } from '@/lib/supabase/admin';

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
      // Key already exists — fetch the cached response
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('bridge_idempotency_keys')
          .select('response')
          .eq('key', key)
          .single();

        if (existing && existing.response && Object.keys(existing.response).length > 0) {
          return existing.response;
        }
      }
      // Key doesn't exist yet or wasn't inserted — continue to call the function
      return null;
    }

    // Key was inserted successfully — continue to call the function
    return null;
  } catch (error) {
    console.error('[Idempotency] checkAndClaimIdempotencyKey error:', error);
    // On error, don't block the request — allow it to proceed
    return null;
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
