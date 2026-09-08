/**
 * checkAndClaimIdempotencyKey — the concurrent-duplicate guarantee.
 *
 * The claim is an INSERT into bridge_idempotency_keys. The winner publishes its
 * response only AFTER the vote completes, so a duplicate that loses the race
 * reads a placeholder `{}`. That used to fall through to `return null`, which
 * the bridge reads as "no cached result — go cast the vote", producing a SECOND
 * vote for one idempotency key. These tests pin the four outcomes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndClaimIdempotencyKey } from '@/server/voting-bridge/idempotency';
import { createAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/lib/supabase/admin');

const UNIQUE_VIOLATION = { code: '23505', message: 'duplicate key value' };

/**
 * Minimal stand-in for the two shapes the function uses:
 *   .from().insert().select().single()   — the claim
 *   .from().select().eq().single()       — reading the winner's response
 * `claimResult` answers the first; `reads` is consumed one entry per lookup.
 */
function stubSupabase(claimResult: unknown, reads: unknown[]) {
  const readQueue = [...reads];
  const client: Record<string, unknown> = {};
  Object.assign(client, {
    from: vi.fn(() => client),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({ single: vi.fn().mockResolvedValue(claimResult) })),
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(readQueue.shift() ?? { data: null }),
      })),
    })),
  });
  return client;
}

describe('checkAndClaimIdempotencyKey — concurrent duplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('returns null for the winner so the caller proceeds to vote', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubSupabase({ data: { response: {} }, error: null }, []) as never,
    );
    await expect(checkAndClaimIdempotencyKey('key-winner')).resolves.toBeNull();
  });

  it('returns the cached response when the original already published', async () => {
    const cached = { success: true, voteId: 'vote-1', totalVotes: 42 };
    vi.mocked(createAdminClient).mockReturnValue(
      stubSupabase(
        { data: null, error: UNIQUE_VIOLATION },
        [{ data: { response: cached } }],
      ) as never,
    );
    await expect(checkAndClaimIdempotencyKey('key-done')).resolves.toEqual(cached);
  });

  it('waits for an in-flight original rather than casting a second vote', async () => {
    const cached = { success: true, voteId: 'vote-1' };
    vi.mocked(createAdminClient).mockReturnValue(
      stubSupabase({ data: null, error: UNIQUE_VIOLATION }, [
        { data: { response: {} } }, // still in flight
        { data: { response: {} } }, // still in flight
        { data: { response: cached } }, // original published
      ]) as never,
    );
    // The pre-fix behaviour returned null here, which the bridge treats as
    // "cast the vote" — the double-vote this guards against.
    await expect(checkAndClaimIdempotencyKey('key-inflight')).resolves.toEqual(cached);
  });

  it('refuses with 409 rather than proceeding when the original never publishes', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubSupabase(
        { data: null, error: UNIQUE_VIOLATION },
        Array.from({ length: 12 }, () => ({ data: { response: {} } })),
      ) as never,
    );
    await expect(checkAndClaimIdempotencyKey('key-wedged')).rejects.toMatchObject({
      status: 409,
    });
    await expect(checkAndClaimIdempotencyKey('key-wedged')).rejects.toBeInstanceOf(ApiError);
  });

  it('stays fail-open on a non-conflict insert error', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubSupabase({ data: null, error: { code: '42P01', message: 'undefined_table' } }, []) as never,
    );
    await expect(checkAndClaimIdempotencyKey('key-other-error')).resolves.toBeNull();
  });
});
