/**
 * Test: Bridge Saga (Failure Handling)
 * Ensures failed operations don't cache successful results
 *
 * Scenario: castFreeVote() throws error after KYC gate passes
 * Expected: bridge_idempotency_keys NOT stored; retry should re-attempt
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bridgedCastFreeVote } from '@/server/voting-bridge/bridge';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertKycTier, KycGateError } from '@/server/voting-bridge/kyc-gate';
import { castFreeVoteAtomic } from '@/server/voting-bridge/free-vote-atomic';
import { fakeIdempotencyTable } from './_idempotency-fake';
import { enableBridge } from '@/server/voting-bridge/feature-flag';

vi.mock('@/lib/supabase/admin');

// The KYC tier gate is mocked at the module boundary rather than choreographed
// through the Supabase stub below. bridgedCastFreeVote gained the
// assertKycTier() call (bridge.ts step 2) in the same commit that added these
// specs, so their stubs never arranged its three-query chain
// (profiles -> contestants -> competitions); single() returned undefined, the
// gate fail-closed on the TypeError, and every vote in this file was refused.
// Mocking the gate keeps each test on its actual subject — idempotency, caching
// and outbox behaviour — while the gate's own logic stays covered by
// tests/unit/voting/kyc-gate.spec.ts.
// The vote itself is the atomic claim now (bridge.ts step 3), not an INSERT
// through the Supabase stub below. Mock it at the module boundary so these tests
// stay on their subject — idempotency, caching, retry and outbox — and keep the
// stub for what still goes through it: the bridge_idempotency_keys row. The
// claim's own behaviour is covered by free-vote-atomic.spec.ts.
vi.mock('@/server/voting-bridge/free-vote-atomic', () => ({
  castFreeVoteAtomic: vi.fn(),
}));

/** What a successful claim returns; mirrors CastFreeVoteResponse. */
const CLAIM_OK = {
  success: true,
  votesAdded: 1,
  totalFreeVotesUsed: 1,
  freeVotesRemaining: 2,
  newTotalVotes: 0,
  fraudStatus: 'clean' as const,
  resetAt: '2026-01-02T00:00:00.000Z',
  contestantId: '2',
};

vi.mock('@/server/voting-bridge/kyc-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/voting-bridge/kyc-gate')>();
  return { ...actual, assertKycTier: vi.fn() };
});

describe('Bridge Saga (Failure Handling)', () => {
  const mockVoteRequest = {
    contestantId: '2',
    contestId: '1',
  };

  const mockContext = {
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Test)',
  };

  const userId = 'user-123';
  const idempotencyKey = 'request-xyz-789';

  beforeEach(() => {
    // Call history leaks between tests otherwise, which matters now that these
    // specs assert HOW MANY times the claim ran. Implementations survive clear().
    vi.clearAllMocks();
    vi.mocked(assertKycTier).mockResolvedValue(true as never);
    vi.mocked(castFreeVoteAtomic).mockResolvedValue(CLAIM_OK as never);
    enableBridge();
  });

  it('should not cache failed vote attempts', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    let idempotencyInsertCalled = false;
    let voteInsertCalled = false;
    let resultUpdateCalled = false;

    // Step 1: Idempotency check (key doesn't exist)
    mockSupabase.insert.mockImplementationOnce(() => {
      idempotencyInsertCalled = true;
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} },
        error: null,
      });
      return mockSupabase;
    });

    // Step 2: KYC gate passes (mock assertKycTier)
    // (assumes successful KYC check)

    // Step 3: the atomic claim throws (was: an INSERT that returned an error)
    vi.mocked(castFreeVoteAtomic).mockImplementationOnce(async () => {
      voteInsertCalled = true;
      throw new Error('Database error during vote claim');
    });

    // Step 4: Result update should NOT be called
    mockSupabase.update.mockImplementationOnce(() => {
      resultUpdateCalled = true;
      mockSupabase.eq.mockResolvedValueOnce({ error: null });
      return mockSupabase;
    });

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    // Vote should fail
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Idempotency insert was attempted
    expect(idempotencyInsertCalled).toBe(true);

    // Vote insert was attempted but failed
    expect(voteInsertCalled).toBe(true);

    // Result update should NOT have been called (no caching of failure)
    expect(resultUpdateCalled).toBe(false);
  });

  it('should allow retry after failed vote', async () => {
    const { client, rows } = fakeIdempotencyTable();
    (createAdminClient as any).mockReturnValue(client);

    // First attempt: the claim fails.
    vi.mocked(castFreeVoteAtomic).mockRejectedValueOnce(new Error('Temporary error'));

    const result1 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );
    expect(result1.success).toBe(false);

    // The failed attempt must LEAVE NO CLAIM behind. The claim row is written
    // before the vote and filled in after, so without an explicit release a
    // failure strands a row holding an empty response — and the wait-then-409
    // guard would then refuse every retry of this key permanently, turning one
    // transient failure into a key the voter can never use again.
    expect(rows.has(idempotencyKey)).toBe(false);

    // Second attempt with the SAME key therefore re-attempts and succeeds.
    const result2 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result2.success).toBe(true);
    expect(result2.votesAdded).toBe(CLAIM_OK.votesAdded);
    expect(result2.freeVotesRemaining).toBe(CLAIM_OK.freeVotesRemaining);
    expect(castFreeVoteAtomic).toHaveBeenCalledTimes(2);
  });

  it('should handle KYC gate failures without caching', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Idempotency check passes
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} },
        error: null,
      });
      return mockSupabase;
    });

    // KYC gate rejects: voter is Tier 0, the contest requires Tier 2.
    vi.mocked(assertKycTier).mockRejectedValueOnce(
      new KycGateError('Insufficient KYC tier: requires tier 2, user has tier 0', 403),
    );

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    // Should fail KYC gate
    expect(result.success).toBe(false);
    expect(result.error).toContain('tier');
  });

  it('preserves the thrown status code so the route can answer 403, not 400', async () => {
    // The failure path used to return only { success, error }, so the route
    // mapped a KYC rejection and a malformed body to the same 400. Carrying the
    // code is what lets /api/v2/votes/free answer 403 (and, once the atomic
    // claim is wired, 429 for a cap-exhausted voter).
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };
    (createAdminClient as any).mockReturnValue(mockSupabase);
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({ data: { response: {} }, error: null });
      return mockSupabase;
    });

    vi.mocked(assertKycTier).mockRejectedValueOnce(
      new KycGateError('Insufficient KYC tier: requires tier 2, user has tier 0', 403),
    );

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it('should handle race between failure and cache storage', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Idempotency check
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} },
        error: null,
      });
      return mockSupabase;
    });

    // The claim fails
    vi.mocked(castFreeVoteAtomic).mockRejectedValueOnce(new Error('Vote claim failed'));

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result.success).toBe(false);

    // Verify update was never called (no result caching on failure).
    // storeIdempotencyResult is the only writer of `update`; the failure path
    // now issues a `delete` to release the claim, which is a separate verb.
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it('should enqueue outbox events only on success', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    let outboxInsertCount = 0;

    // Setup: vote insert fails
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} },
        error: null,
      });
      return mockSupabase;
    });

    // The claim fails, so nothing downstream of it should run
    vi.mocked(castFreeVoteAtomic).mockRejectedValueOnce(new Error('Vote claim failed'));

    // Track any further inserts — an outbox enqueue would land here
    mockSupabase.insert.mockImplementationOnce(() => {
      outboxInsertCount++;
      return mockSupabase;
    });

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result.success).toBe(false);
    // Outbox events are enqueued only after a successful claim. The original
    // spec left this implicit with a comment and asserted nothing; now that the
    // counter is actually reachable, assert it.
    expect(outboxInsertCount).toBe(0);
  });
});
