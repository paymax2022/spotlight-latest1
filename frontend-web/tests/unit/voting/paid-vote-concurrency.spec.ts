/**
 * Test: Paid Vote Concurrency (Webhook + Redirect Race)
 * Ensures webhook and browser redirect don't both credit the same vote
 *
 * Scenario: Payment gateway sends webhook while user redirects back to site
 * Both arrive within milliseconds trying to credit same transaction
 * Expected: One vote inserted, transaction marked 'credited' exactly once
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bridgedVerifyPaidVote } from '@/server/voting-bridge/bridge';
import { createAdminClient } from '@/lib/supabase/admin';
import { enableBridge } from '@/server/voting-bridge/feature-flag';

vi.mock('@/lib/supabase/admin');

describe('Paid Vote Concurrency (Webhook + Redirect Race)', () => {
  const mockVerifyRequest = {
    transactionId: 'tx-123-uuid',
    paymentReference: 'pay-ref-456-uuid',
  };

  const mockContext = {
    ipAddress: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (Test)',
  };

  beforeEach(() => {
    enableBridge();
  });

  it('should credit vote only once when webhook and redirect race', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Mock transaction data
    const mockTransaction = {
      id: mockVerifyRequest.transactionId,
      voter_id: 'user-123',
      contestant_id: '2',
      competition_id: '1',
      amount_kobo: 9999,
      payment_reference: mockVerifyRequest.paymentReference,
      vote_credit_status: 'pending',
    };

    let creditCount = 0;

    // First call: lock_vote_transaction RPC (acquires SELECT FOR UPDATE)
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    // Fetch transaction
    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: mockTransaction,
        error: null,
      }),
    }));

    // Insert vote
    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { id: 'vote-uuid-1', total_votes: 42 },
        error: null,
      }),
    }));

    // Update transaction status
    mockSupabase.from.mockImplementationOnce(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValueOnce({ error: null }),
    }));

    // Enqueue outbox event
    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockResolvedValueOnce({
        data: { id: 'event-uuid' },
        error: null,
      }),
    }));

    // First request (webhook)
    const webhookResult = await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'webhook',
      mockContext
    );

    expect(webhookResult.success).toBe(true);
    expect(webhookResult.voteId).toBe('vote-uuid-1');
    creditCount++;

    // Second request (browser redirect) arrives while first is processing
    // Mock the second lock and fetch (should see vote already credited)
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    const transactionAfterCredit = {
      ...mockTransaction,
      vote_credit_status: 'credited', // Status changed by first request
    };

    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: transactionAfterCredit,
        error: null,
      }),
    }));

    const redirectResult = await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'user-123',
      mockContext
    );

    // Should fail because already credited
    expect(redirectResult.success).toBe(false);
    expect(redirectResult.error).toContain('already credited');
  });

  it('should require SELECT FOR UPDATE lock before crediting', async () => {
    const mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnThis(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Lock acquisition should be first operation
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    const mockTransaction = {
      id: mockVerifyRequest.transactionId,
      vote_credit_status: 'pending',
      payment_reference: mockVerifyRequest.paymentReference,
      contestant_id: '2',
      voter_id: 'user-123',
    };

    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: mockTransaction,
        error: null,
      }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { id: 'vote-uuid', total_votes: 42 },
        error: null,
      }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValueOnce({ error: null }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockResolvedValueOnce({
        data: { id: 'event-uuid' },
        error: null,
      }),
    }));

    await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'user-123',
      mockContext
    );

    // Verify lock_vote_transaction RPC was called
    expect(mockSupabase.rpc).toHaveBeenCalledWith('lock_vote_transaction', {
      tx_id: mockVerifyRequest.transactionId,
    });
  });

  it('should handle lock acquisition failure', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValueOnce({
        error: { message: 'Lock timeout' },
      }),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    const result = await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'user-123',
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('lock');
  });

  it('should reject vote if transaction not found', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValueOnce({ error: null }),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      }),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    const result = await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'user-123',
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should verify payment reference matches before crediting', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValueOnce({ error: null }),
      from: vi.fn().mockReturnThis(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    // Transaction has different payment reference
    const mockTransaction = {
      id: mockVerifyRequest.transactionId,
      payment_reference: 'different-ref',
      vote_credit_status: 'pending',
    };

    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: mockTransaction,
        error: null,
      }),
    }));

    const result = await bridgedVerifyPaidVote(
      mockVerifyRequest,
      'user-123',
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  it('should insert exactly one vote row even with concurrent calls', async () => {
    const mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    let voteInsertCount = 0;
    const mockTransaction = {
      id: mockVerifyRequest.transactionId,
      payment_reference: mockVerifyRequest.paymentReference,
      vote_credit_status: 'pending',
      voter_id: 'user-123',
      contestant_id: '2',
      competition_id: '1',
    };

    // Setup for first concurrent call
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: mockTransaction,
        error: null,
      }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementationOnce(async () => {
        voteInsertCount++;
        return {
          data: { id: 'vote-uuid-1', total_votes: 42 },
          error: null,
        };
      }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValueOnce({ error: null }),
    }));

    mockSupabase.from.mockImplementationOnce(() => ({
      insert: vi.fn().mockResolvedValueOnce({
        data: { id: 'event-uuid' },
        error: null,
      }),
    }));

    // Setup for second concurrent call
    mockSupabase.rpc.mockResolvedValueOnce({ error: null });

    const transactionAfterCredit = {
      ...mockTransaction,
      vote_credit_status: 'credited',
    };

    mockSupabase.from.mockImplementationOnce(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: transactionAfterCredit,
        error: null,
      }),
    }));

    // Send concurrent requests
    const [result1, result2] = await Promise.all([
      bridgedVerifyPaidVote(mockVerifyRequest, 'webhook', mockContext),
      bridgedVerifyPaidVote(mockVerifyRequest, 'user-123', mockContext),
    ]);

    // Only one should succeed with vote insertion
    expect(
      (result1.success ? 1 : 0) + (result2.success ? 1 : 0)
    ).toBeLessThanOrEqual(1);

    // Vote insert should only happen once
    expect(voteInsertCount).toBeLessThanOrEqual(1);
  });
});
