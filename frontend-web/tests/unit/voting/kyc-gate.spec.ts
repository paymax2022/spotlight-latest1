/**
 * Test: KYC Tier Gate
 * Ensures users meet tier requirements before voting
 *
 * Scenario: Tier 0 user tries to vote in Tier 2 contest → blocked
 * Scenario: Tier 2 user votes in Tier 2 contest → allowed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assertKycTier,
  getUserKycTier,
  getContestKycRequirement,
  KycGateError,
} from '@/server/voting-bridge/kyc-gate';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin');

describe('KYC Tier Gate', () => {
  const userId = 'user-123';
  const contestantId = '2';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertKycTier', () => {
    it('should allow user with sufficient tier', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // User has Tier 2
      mockSupabase.single.mockResolvedValueOnce({
        data: { kyc_tier: 2 },
        error: null,
      });

      // Contest requires Tier 2
      mockSupabase.single.mockResolvedValueOnce({
        data: { competition_id: '1' },
        error: null,
      });

      mockSupabase.single.mockResolvedValueOnce({
        data: { required_kyc_tier: 2 },
        error: null,
      });

      const result = await assertKycTier(userId, contestantId);

      expect(result).toBe(true);
    });

    it('should block user with insufficient tier', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // User has Tier 0 (unverified)
      mockSupabase.single.mockResolvedValueOnce({
        data: { kyc_tier: 0 },
        error: null,
      });

      // Contestant belongs to this competition
      mockSupabase.single.mockResolvedValueOnce({
        data: { competition_id: '1' },
        error: null,
      });

      // Contest requires Tier 2
      mockSupabase.single.mockResolvedValueOnce({
        data: { required_kyc_tier: 2 },
        error: null,
      });

      try {
        await assertKycTier(userId, contestantId);
        expect.fail('Should have thrown KycGateError');
      } catch (error) {
        expect(error).toBeInstanceOf(KycGateError);
        expect((error as KycGateError).statusCode).toBe(403);
        expect(error).toMatchObject({
          message: expect.stringContaining('tier'),
        });
      }
    });

    it('should allow vote when contest has no tier requirement', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // User has Tier 0
      mockSupabase.single.mockResolvedValueOnce({
        data: { kyc_tier: 0 },
        error: null,
      });

      // Get contestant competition
      mockSupabase.single.mockResolvedValueOnce({
        data: { competition_id: '1' },
        error: null,
      });

      // Contest has no requirement
      mockSupabase.single.mockResolvedValueOnce({
        data: { required_kyc_tier: 0 },
        error: null,
      });

      const result = await assertKycTier(userId, contestantId);

      expect(result).toBe(true);
    });

    it('should handle user not found', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'User not found' },
        }),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      try {
        await assertKycTier(userId, contestantId);
        expect.fail('Should have thrown KycGateError');
      } catch (error) {
        expect(error).toBeInstanceOf(KycGateError);
        expect((error as KycGateError).statusCode).toBe(404);
      }
    });

    it('should handle contestant not found', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // User found
      mockSupabase.single.mockResolvedValueOnce({
        data: { kyc_tier: 2 },
        error: null,
      });

      // Contestant not found
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Contestant not found' },
      });

      try {
        await assertKycTier(userId, contestantId);
        expect.fail('Should have thrown KycGateError');
      } catch (error) {
        expect(error).toBeInstanceOf(KycGateError);
        expect((error as KycGateError).statusCode).toBe(404);
      }
    });

    it('should handle tier levels 0-5', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // Test each tier level
      const tierTests = [
        { userTier: 0, required: 0, allowed: true },  // Tier 0, no requirement
        { userTier: 0, required: 1, allowed: false }, // Tier 0, needs Tier 1
        { userTier: 1, required: 1, allowed: true },  // Tier 1, needs Tier 1
        { userTier: 1, required: 2, allowed: false }, // Tier 1, needs Tier 2
        { userTier: 5, required: 2, allowed: true },  // Tier 5, needs Tier 2
        { userTier: 5, required: 5, allowed: true },  // Tier 5, needs Tier 5
      ];

      for (const test of tierTests) {
        // Reset mocks for each test
        vi.clearAllMocks();
        (createAdminClient as any).mockReturnValue(mockSupabase);

        mockSupabase.single.mockResolvedValueOnce({
          data: { kyc_tier: test.userTier },
          error: null,
        });

        mockSupabase.single.mockResolvedValueOnce({
          data: { competition_id: '1' },
          error: null,
        });

        mockSupabase.single.mockResolvedValueOnce({
          data: { required_kyc_tier: test.required },
          error: null,
        });

        try {
          await assertKycTier(userId, contestantId);
          expect(test.allowed).toBe(true);
        } catch (error) {
          expect(test.allowed).toBe(false);
          expect(error).toBeInstanceOf(KycGateError);
        }
      }
    });
  });

  describe('getUserKycTier', () => {
    it('should return user tier', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: { kyc_tier: 3 },
          error: null,
        }),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      const tier = await getUserKycTier(userId);

      expect(tier).toBe(3);
    });

    it('should return 0 if user not found', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'Not found' },
        }),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      const tier = await getUserKycTier(userId);

      expect(tier).toBe(0);
    });

    // Carried over from tests/unit/voting-bridge/kyc-gate.spec.ts, deleted because
  // it targeted assertKycGate/getKycProfile — an API that exists on neither
  // develop nor main. Its other three cases are covered above; this one is not,
  // because the concept does not exist: nothing in voting-bridge/ or voting/
  // checks account suspension, so a suspended user can currently vote. Left as a
  // todo rather than a failing test, since it describes unbuilt behaviour.
  it.todo('should block suspended users — no suspension check exists in the voting path today');

  it('should handle database errors gracefully', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockRejectedValueOnce(new Error('DB error')),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      const tier = await getUserKycTier(userId);

      expect(tier).toBe(0);
    });
  });

  describe('getContestKycRequirement', () => {
    it('should return contest tier requirement', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      // Get contestant's competition
      mockSupabase.single.mockResolvedValueOnce({
        data: { competition_id: '1' },
        error: null,
      });

      // Get competition requirement
      mockSupabase.single.mockResolvedValueOnce({
        data: { required_kyc_tier: 2 },
        error: null,
      });

      const requirement = await getContestKycRequirement(contestantId);

      expect(requirement).toBe(2);
    });

    it('should return 0 if no requirement', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      mockSupabase.single.mockResolvedValueOnce({
        data: { competition_id: '1' },
        error: null,
      });

      mockSupabase.single.mockResolvedValueOnce({
        data: { required_kyc_tier: null },
        error: null,
      });

      const requirement = await getContestKycRequirement(contestantId);

      expect(requirement).toBe(0);
    });

    it('should return 0 if contestant not found', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'Not found' },
        }),
      };

      (createAdminClient as any).mockReturnValue(mockSupabase);

      const requirement = await getContestKycRequirement(contestantId);

      expect(requirement).toBe(0);
    });
  });
});
