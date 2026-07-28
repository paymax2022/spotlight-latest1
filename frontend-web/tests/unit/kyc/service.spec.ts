/**
 * KYC service — state machine and tier gate tests.
 *
 * Supabase is mocked; tests run in node environment with no DB.
 * Each test configures exactly the mock responses it needs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  getKycProfile,
  getKycTier,
  initiateKyc,
  approveKyc,
  failKyc,
  suspendKyc,
} from '@/src/server/kyc/service';
import { requireKycTier } from '@/src/server/kyc/gate';
import { createAdminClient } from '@/lib/supabase/server';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-kyc-001';
const ACTOR_ID = 'admin-001';

function unverifiedProfile() {
  return {
    kyc_tier: 0,
    kyc_status: 'unverified',
    phone_verified: false,
    kyc_submitted_at: null,
    kyc_verified_at: null,
    document_type: null,
  };
}

function pendingProfile() {
  return {
    ...unverifiedProfile(),
    kyc_status: 'pending',
    kyc_submitted_at: '2026-06-13T10:00:00.000Z',
    document_type: 'BVN',
  };
}

function verifiedProfile(tier = 1) {
  return {
    ...pendingProfile(),
    kyc_status: 'verified',
    kyc_tier: tier,
    kyc_verified_at: '2026-06-13T12:00:00.000Z',
  };
}

/**
 * Set up mock for: one maybySingle SELECT (returns profileRow) + one UPDATE.eq + one INSERT (event).
 * updateEq is the terminal .eq() after .update() — this is what gets awaited.
 */
function setupMockForTransition(profileRow: Record<string, unknown> | null) {
  const { mock, maybySingle, updateFn, updateEq, insertFn } = makeSupabaseMock();

  // SELECT returns profile
  maybySingle.mockResolvedValueOnce({ data: profileRow, error: null });
  // updateEq is the terminal awaitable in .update({}).eq('id', x)
  updateEq.mockResolvedValueOnce({ data: null, error: null });
  // INSERT (kyc_events) succeeds
  insertFn.mockResolvedValueOnce({ error: null });

  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return { mock, maybySingle, updateFn, updateEq, insertFn };
}

// ── Tests: getKycProfile ──────────────────────────────────────────────────────

describe('getKycProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tier=0 / status=unverified for a new user with no KYC data', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const profile = await getKycProfile(USER_ID);
    expect(profile.kyc_tier).toBe(0);
    expect(profile.kyc_status).toBe('unverified');
    expect(profile.phone_verified).toBe(false);
  });

  it('returns existing KYC data when the profile row has columns', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: verifiedProfile(2), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const profile = await getKycProfile(USER_ID);
    expect(profile.kyc_tier).toBe(2);
    expect(profile.kyc_status).toBe('verified');
  });
});

// ── Tests: getKycTier ─────────────────────────────────────────────────────────

describe('getKycTier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 for new users', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    expect(await getKycTier(USER_ID)).toBe(0);
  });

  it('returns the correct tier from the DB', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: verifiedProfile(3), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    expect(await getKycTier(USER_ID)).toBe(3);
  });
});

// ── Tests: initiateKyc ────────────────────────────────────────────────────────

describe('initiateKyc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions unverified → pending on valid input', async () => {
    setupMockForTransition(unverifiedProfile());

    const result = await initiateKyc(USER_ID, {
      document_type: 'BVN',
      document_number: '12345678901',
    });

    expect(result.kyc_status).toBe('pending');
    expect(result.document_type).toBe('BVN');
  });

  it('is idempotent — returns current profile when already pending (no DB write)', async () => {
    const { mock, maybySingle, updateFn, updateEq } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: pendingProfile(), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const result = await initiateKyc(USER_ID, {
      document_type: 'BVN',
      document_number: '12345678901',
    });

    expect(result.kyc_status).toBe('pending');
    expect(updateFn).not.toHaveBeenCalled(); // no write since already pending
    expect(updateEq).not.toHaveBeenCalled();
  });

  it('transitions failed → pending (retry path)', async () => {
    setupMockForTransition({ ...unverifiedProfile(), kyc_status: 'failed' });

    const result = await initiateKyc(USER_ID, {
      document_type: 'NIN',
      document_number: '98765432100',
    });

    expect(result.kyc_status).toBe('pending');
    expect(result.document_type).toBe('NIN');
  });

  it('throws 409 when trying to initiate from verified status', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: verifiedProfile(1), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(
      initiateKyc(USER_ID, { document_type: 'BVN', document_number: '12345678901' }),
    ).rejects.toThrow(/transition.*not permitted/i);
  });

  it('throws 409 when trying to initiate from suspended status', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({
      data: { ...unverifiedProfile(), kyc_status: 'suspended' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(
      initiateKyc(USER_ID, { document_type: 'BVN', document_number: '12345678901' }),
    ).rejects.toThrow(/transition.*not permitted/i);
  });
});

// ── Tests: approveKyc ────────────────────────────────────────────────────────

describe('approveKyc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions pending → verified with correct tier', async () => {
    setupMockForTransition(pendingProfile());

    const result = await approveKyc(USER_ID, 1, ACTOR_ID);

    expect(result.kyc_status).toBe('verified');
    expect(result.kyc_tier).toBe(1);
    expect(result.kyc_verified_at).toBeTruthy();
  });

  it('throws 409 when approving a user who is not pending', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: unverifiedProfile(), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(approveKyc(USER_ID, 1, ACTOR_ID)).rejects.toThrow(/transition.*not permitted/i);
  });
});

// ── Tests: failKyc ───────────────────────────────────────────────────────────

describe('failKyc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions pending → failed', async () => {
    setupMockForTransition(pendingProfile());

    const result = await failKyc(USER_ID, 'BVN name mismatch', ACTOR_ID);
    expect(result.kyc_status).toBe('failed');
    expect(result.kyc_tier).toBe(0); // tier unchanged on failure
  });

  it('throws 409 when failing a user who is not pending', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: verifiedProfile(1), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(failKyc(USER_ID, 'reason', ACTOR_ID)).rejects.toThrow(/transition.*not permitted/i);
  });
});

// ── Tests: suspendKyc ────────────────────────────────────────────────────────

describe('suspendKyc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transitions verified → suspended', async () => {
    setupMockForTransition(verifiedProfile(2));

    const result = await suspendKyc(USER_ID, 'Fraud detected post-approval', ACTOR_ID);
    expect(result.kyc_status).toBe('suspended');
  });

  it('throws 409 when suspending an unverified user', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: unverifiedProfile(), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(suspendKyc(USER_ID, 'reason', ACTOR_ID)).rejects.toThrow(/transition.*not permitted/i);
  });
});

// ── Tests: requireKycTier ─────────────────────────────────────────────────────

describe('requireKycTier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not throw when user meets the required tier', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: verifiedProfile(2), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(requireKycTier(USER_ID, 2)).resolves.not.toThrow();
  });

  it('throws 403 when user tier is below required', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: unverifiedProfile(), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(requireKycTier(USER_ID, 1)).rejects.toThrow(ApiError);
    try {
      await requireKycTier(USER_ID, 1);
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  it('throws 403 fail-closed when Supabase errors', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: { message: 'connection refused' } });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    // maybySingle error causes getKycProfile to throw → requireKycTier catches and denies
    const { mock: mock2, maybySingle: ms2 } = makeSupabaseMock();
    ms2.mockRejectedValueOnce(new Error('connection refused'));
    vi.mocked(createAdminClient).mockReturnValueOnce(mock2 as any);

    await expect(requireKycTier(USER_ID, 1)).rejects.toMatchObject({ status: 403 });
  });
});
