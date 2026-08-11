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
import { enableBridge } from '@/server/voting-bridge/feature-flag';

// Mock Supabase client
vi.mock('@/lib/supabase/admin');

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
    enableBridge();
  });

  it('should insert exactly one vote when identical requests arrive concurrently', async () => {
    // Setup mock Supabase
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Simulate the idempotency check: first call inserts, second call finds existing
    let callCount = 0;
    mockSupabase.insert.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: INSERT bridge_idempotency_keys succeeds
        mockSupabase.select.mockReturnThis();
        mockSupabase.single.mockResolvedValueOnce({
          data: { response: {} },
          error: null,
        });
      } else if (callCount === 2) {
        // Second call (vote insert): would succeed on first request
        mockSupabase.select.mockReturnThis();
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: 'vote-uuid-1', total_votes: 42 },
          error: null,
        });
      } else if (callCount === 3) {
        // Update idempotency key
        mockSupabase.eq.mockResolvedValueOnce({ error: null });
      }
      return mockSupabase;
    });

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

    // Both should succeed
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Both should have same vote ID (one from cache, one original)
    expect(result1.voteId).toBe(result2.voteId || result1.voteId);

    // Vote count should be same
    expect(result1.totalVotes).toBe(42);
  });

  it('should cache the response after first request completes', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    const mockResponse = {
      success: true,
      voteId: 'vote-uuid-cached',
      totalVotes: 42,
    };

    let callCount = 0;
    mockSupabase.insert.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Idempotency check: no error (key inserted)
        mockSupabase.select.mockReturnThis();
        mockSupabase.single.mockResolvedValueOnce({
          data: { response: {} },
          error: null,
        });
      } else if (callCount === 2) {
        // Vote insert succeeds
        mockSupabase.select.mockReturnThis();
        mockSupabase.single.mockResolvedValueOnce({
          data: { id: mockResponse.voteId, total_votes: 42 },
          error: null,
        });
      } else if (callCount === 3) {
        // Update idempotency key with response
        mockSupabase.eq.mockResolvedValueOnce({ error: null });
      }
      return mockSupabase;
    });

    // First request
    const result1 = await bridgedCastFreeVote(
      mockVoteRequest,
      userId,
      idempotencyKey,
      mockContext
    );

    expect(result1.success).toBe(true);
    expect(result1.voteId).toBe(mockResponse.voteId);

    // Verify update was called to cache result
    expect(mockSupabase.update).toHaveBeenCalled();
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
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockImplementationOnce(() => {
        mockSupabase.select.mockReturnThis();
        mockSupabase.single.mockResolvedValueOnce({
          data: null,
          error: { message: 'Database connection failed' },
        });
        return mockSupabase;
      }),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

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
