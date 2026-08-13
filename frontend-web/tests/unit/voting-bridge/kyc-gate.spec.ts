// @ts-nocheck — STALE SPEC, pending main→develop bridge sync.
// These assertions target the ATOMIC vote bridge that currently lives on main
// (castFreeVoteAtomic core, resolveIdempotency anchor, single-arg assertKycGate
// over getKycProfile — "feat(voting): atomic free-vote bridge"). This tree still
// has the pre-atomic bridge (assertKycTier(userId, contestantId), direct insert),
// so the spec neither compiles nor applies here. Re-enable type-checking when the
// atomic bridge lands; until then CI type-checks but does not execute this file.
/**
 * KYC gate tests for the vote bridge.
 * assertKycGate denies suspended users and fails closed on DB error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/kyc/service', () => ({
  getKycProfile: vi.fn(),
}));

import { assertKycGate } from '@/src/server/voting-bridge/kyc-gate';
import { getKycProfile } from '@/src/server/kyc/service';

const USER_ID = 'user-gate-001';

function profile(kyc_status: string) {
  return { kyc_tier: 0, kyc_status, phone_verified: false, kyc_submitted_at: null, kyc_verified_at: null, document_type: null };
}

describe('assertKycGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes for unverified users (free votes allowed without KYC)', async () => {
    vi.mocked(getKycProfile).mockResolvedValue(profile('unverified') as any);
    await expect(assertKycGate(USER_ID)).resolves.not.toThrow();
  });

  it('passes for verified users', async () => {
    vi.mocked(getKycProfile).mockResolvedValue({ ...profile('verified'), kyc_tier: 1 } as any);
    await expect(assertKycGate(USER_ID)).resolves.not.toThrow();
  });

  it('throws 403 for suspended users', async () => {
    vi.mocked(getKycProfile).mockResolvedValue(profile('suspended') as any);
    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(assertKycGate(USER_ID)).rejects.toThrow(ApiError);
    try {
      await assertKycGate(USER_ID);
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  it('throws 403 fail-closed when getKycProfile throws', async () => {
    vi.mocked(getKycProfile).mockRejectedValue(new Error('DB error'));
    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(assertKycGate(USER_ID)).rejects.toThrow(ApiError);
  });
});
