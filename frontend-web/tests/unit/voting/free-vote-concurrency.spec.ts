/**
 * Test: Free Vote Concurrency
 * Ensures identical concurrent requests produce exactly one vote row
 *
 * Scenario: User clicks "vote" button twice rapidly, or retry logic sends duplicate
 * Expected: One vote inserted, one idempotency key cached
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bridgedCastFreeVote } from '@/server/voting-bridge/bridge';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertKycTier, KycGateError } from '@/server/voting-bridge/kyc-gate';
import { castFreeVoteAtomic } from '@/server/voting-bridge/free-vote-atomic';
import { fakeIdempotencyTable } from './_idempotency-fake';
import { enableBridge } from '@/server/voting-bridge/feature-flag';

// Mock Supabase client
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

describe('Free Vote Concurrency', () => {
  const mockVoteRequest = {
    contestantId: '2',
    contestId: '1',
    shareCode: 'ABC123',
  };

  const mockContext = {
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Test)',
    deviceFingerprint: 'fp-123',
  };

  const userId = 'user-123';
  const idempotencyKey = 'request-abc-def-ghi-123';

  beforeEach(() => {
    // Call history leaks between tests otherwise, which matters now that these
    // specs assert HOW MANY times the claim ran. Implementations survive clear().
    vi.clearAllMocks();
    vi.mocked(assertKycTier).mockResolvedValue(true as never);
    vi.mocked(castFreeVoteAtomic).mockResolvedValue(CLAIM_OK as never);
    enableBridge();
  });

  it('should insert exactly one vote when identical requests arrive concurrently', async () => {
    const { client } = fakeIdempotencyTable();
    (createAdminClient as any).mockReturnValue(client);

    // Send two identical requests concurrently
    const request1 = bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    const request2 = bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    const [result1, result2] = await Promise.all([request1, request2]);

    // Both callers get an answer...
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // ...but only ONE of them voted. This is the whole point of the file, and it
    // is only expressible now that the vote is a single mockable call: before,
    // the vote was an INSERT indistinguishable from the idempotency INSERT in
    // the same stub.
    expect(castFreeVoteAtomic).toHaveBeenCalledTimes(1);

    // The duplicate is served the winner's allowance, not a fresh one.
    expect(result2.freeVotesRemaining).toBe(CLAIM_OK.freeVotesRemaining);
  });

  it('should cache the response after first request completes', async () => {
    const { client, rows } = fakeIdempotencyTable();
    (createAdminClient as any).mockReturnValue(client);

    const result1 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result1.success).toBe(true);
    // Asserted on the allowance, not a vote id: the atomic claim returns no id,
    // so voteId left the v2 contract with it.
    expect(result1.freeVotesRemaining).toBe(CLAIM_OK.freeVotesRemaining);

    // The result was published against the key, so a later duplicate can be
    // served from it rather than voting again.
    expect(client.update).toHaveBeenCalled();
    expect(rows.get(idempotencyKey)?.response).toMatchObject({ success: true });
  });

  it('should return cached result on second identical request', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    const cachedResponse = {
      success: true,
      voteId: 'vote-uuid-cached',
      totalVotes: 42,
    };

    // Idempotency check: key already exists with cached response
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505' }, // Unique constraint violation
      });
      return mockSupabase;
    });

    // Fetch existing key
    mockSupabase.select.mockImplementationOnce(() => {
      mockSupabase.eq.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: cachedResponse },
        error: null,
      });
      return mockSupabase;
    });

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    // Should return cached response
    expect(result.success).toBe(true);
    expect(result.voteId).toBe(cachedResponse.voteId);
    expect(result.totalVotes).toBe(42);
  });

  it('should reject vote without idempotency key', async () => {
    enableBridge();

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      '', // Empty idempotency key
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Idempotency-Key');
  });

  it('should handle database errors gracefully', async () => {
    const { client } = fakeIdempotencyTable();
    (createAdminClient as any).mockReturnValue(client);

    // The database failure now surfaces from the claim rather than from the
    // vote INSERT the bridge no longer performs.
    vi.mocked(castFreeVoteAtomic).mockRejectedValueOnce(
      new Error('Database connection failed'),
    );

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
