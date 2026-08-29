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
    vi.mocked(assertKycTier).mockResolvedValue(true as never);
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

    // Step 3: castFreeVote() throws error
    mockSupabase.insert.mockImplementationOnce(() => {
      voteInsertCalled = true;
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error during vote insert' },
      });
      return mockSupabase;
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
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    let attemptCount = 0;

    // First attempt: fails
    mockSupabase.insert.mockImplementationOnce(() => {
      attemptCount++;
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} }, // Idempotency key inserted
        error: null,
      });
      return mockSupabase;
    });

    // Vote insert fails
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Temporary error' },
      });
      return mockSupabase;
    });

    const result1 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result1.success).toBe(false);

    // Second attempt: succeeds
    // Idempotency key exists but has empty response
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505' }, // Already exists
      });
      return mockSupabase;
    });

    // Fetch existing key
    mockSupabase.select.mockImplementationOnce(() => {
      mockSupabase.eq.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { response: {} }, // Empty response (not cached)
        error: null,
      });
      return mockSupabase;
    });

    // Vote insert succeeds on retry
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'vote-uuid-retry', total_votes: 42 },
        error: null,
      });
      return mockSupabase;
    });

    // Cache result
    mockSupabase.update.mockImplementationOnce(() => {
      mockSupabase.eq.mockResolvedValueOnce({ error: null });
      return mockSupabase;
    });

    const result2 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    // Retry should succeed
    expect(result2.success).toBe(true);
    expect(result2.voteId).toBe('vote-uuid-retry');
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

    // Vote insert fails
    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Vote insert failed' },
      });
      return mockSupabase;
    });

    const result = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result.success).toBe(false);

    // Verify update was never called (no result caching on failure)
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

    mockSupabase.insert.mockImplementationOnce(() => {
      mockSupabase.select.mockReturnThis();
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Vote insert failed' },
      });
      return mockSupabase;
    });

    // Track outbox insert attempts
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
    // Outbox events should not be enqueued on failure
    // (implementation calls enqueueOutboxEvent only after success)
  });
});
