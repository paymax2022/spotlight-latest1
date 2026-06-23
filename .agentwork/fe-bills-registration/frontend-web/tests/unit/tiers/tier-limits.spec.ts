/**
 * Tier limits enforcement tests — Block 7.
 *
 * All Supabase and KYC calls are mocked — no database required.
 * Covers every acceptance criterion from docs/build-playbook.md § Block 7:
 *   - Tier 0: wallet debit → 403 (wallet disabled)
 *   - Tier 1: daily debit > ₦50k (5,000,000 kobo) → 403
 *   - Tier 2: daily debit > ₦200k (20,000,000 kobo) → 403
 *   - Tier 3: no limit (unlimited)
 *   - FEATURE_TIER_LIMITS_ENABLED=false → limits not enforced
 *   - DB error on limit check → fail closed (503)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must come before imports that use them)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/kyc/service', () => ({
  getKycTier: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { getKycTier } from '@/src/server/kyc/service';
import {
  getTierConfig,
  enforceWalletLimit,
  enforceVoteLimit,
} from '@/src/server/tiers/service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const mockGetKycTier = getKycTier as ReturnType<typeof vi.fn>;

function makeSupabase(overrides: {
  acct?: { data: { id: string } | null; error: null | { message: string } };
  entries?: { data: { amount_kobo: number }[] | null; error: null | { message: string } };
  txCount?: { count: number | null; error: null | { message: string } };
  insert?: { error: null | { message: string } };
}) {
  const from = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(overrides.acct ?? { data: { id: 'acct-1' }, error: null }),
    then: undefined,
    // For count queries (enforceVoteLimit)
    ...(overrides.txCount !== undefined
      ? { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
      : {}),
  });

  // We need different behaviour per table. Simplest: track call order.
  let callCount = 0;
  const fromWithTable = vi.fn().mockImplementation((_table: string) => {
    callCount++;
    if (_table === 'ledger_accounts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(overrides.acct ?? { data: { id: 'acct-1' }, error: null }),
      };
    }
    if (_table === 'ledger_entries') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        // resolves to the entries list (used for daily-total sum)
        then: undefined,
        [Symbol.asyncIterator]: undefined,
        // vitest-friendly: return an array via chained awaitable
        ...(async () => overrides.entries ?? { data: [], error: null }),
        // actual path used by the service: awaited from().select().eq().eq().gte()
        // We intercept at the last call in the chain
        _mockResolvedValue: overrides.entries ?? { data: [], error: null },
      };
    }
    if (_table === 'vote_transactions') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue(overrides.txCount ?? { count: 0, error: null }),
      };
    }
    if (_table === 'tier_limit_events') {
      return {
        insert: vi.fn().mockResolvedValue(overrides.insert ?? { error: null }),
      };
    }
    return from(null);
  });

  return { from: fromWithTable };
}

/**
 * Build a mock Supabase client that resolves the full chain for ledger_entries
 * by making each `eq`/`gte` call return a thenable that resolves to the data.
 */
function buildClient(opts: {
  tier: 0 | 1 | 2 | 3;
  acctId?: string | null;
  dailyTotalKobo?: number;
  acctError?: boolean;
  entriesError?: boolean;
  voteCount?: number;
  votesError?: boolean;
}) {
  const acctId = opts.acctId !== undefined ? opts.acctId : 'acct-1';

  const acctResult = opts.acctError
    ? { data: null, error: { message: 'db error' } }
    : acctId === null
      ? { data: null, error: null }
      : { data: { id: acctId }, error: null };

  const entriesResult = opts.entriesError
    ? { data: null, error: { message: 'db error' } }
    : {
        data: opts.dailyTotalKobo !== undefined
          ? [{ amount_kobo: opts.dailyTotalKobo }]
          : [],
        error: null,
      };

  const voteResult = opts.votesError
    ? { count: null, error: { message: 'db error' } }
    : { count: opts.voteCount ?? 0, error: null };

  const thenable = (resolved: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue(resolved),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    insert: vi.fn().mockResolvedValue({ error: null }),
  });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'ledger_accounts') return thenable(acctResult);
      if (table === 'ledger_entries') return thenable(entriesResult);
      if (table === 'vote_transactions') return thenable(voteResult);
      if (table === 'tier_limit_events') return thenable({ error: null });
      return thenable({ data: null, error: null });
    }),
  };
}

// ---------------------------------------------------------------------------
// getTierConfig
// ---------------------------------------------------------------------------

describe('getTierConfig', () => {
  it('Tier 0: wallet disabled, vote limit null (existing free-vote only)', () => {
    const cfg = getTierConfig(0);
    expect(cfg.dailyWalletLimitKobo).toBe(0);
    expect(cfg.dailyVoteLimit).toBeNull();
  });

  it('Tier 1: ₦50k wallet limit (5,000,000 kobo), 500 votes/day', () => {
    const cfg = getTierConfig(1);
    expect(cfg.dailyWalletLimitKobo).toBe(5_000_000);
    expect(cfg.dailyVoteLimit).toBe(500);
  });

  it('Tier 2: ₦200k wallet limit (20,000,000 kobo), 2000 votes/day', () => {
    const cfg = getTierConfig(2);
    expect(cfg.dailyWalletLimitKobo).toBe(20_000_000);
    expect(cfg.dailyVoteLimit).toBe(2000);
  });

  it('Tier 3: unlimited wallet, unlimited votes', () => {
    const cfg = getTierConfig(3);
    expect(cfg.dailyWalletLimitKobo).toBeNull();
    expect(cfg.dailyVoteLimit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enforceWalletLimit — flag off
// ---------------------------------------------------------------------------

describe('enforceWalletLimit — FEATURE_TIER_LIMITS_ENABLED=false', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns unlimited (null) without touching KYC or DB', async () => {
    const result = await enforceWalletLimit('user-1', 1_000_000);
    expect(result.dailyLimitKobo).toBeNull();
    expect(mockGetKycTier).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enforceWalletLimit — per-tier
// ---------------------------------------------------------------------------

describe('enforceWalletLimit — tier enforcement', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('Tier 0: throws 403 immediately (wallet disabled)', async () => {
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(buildClient({ tier: 0 }));

    await expect(enforceWalletLimit('user-0', 1_000)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('disabled'),
    });
  });

  it('Tier 1: allows debit when under ₦50k daily limit', async () => {
    mockGetKycTier.mockResolvedValue(1);
    // Daily total so far: ₦20k = 2,000,000 kobo. Requesting ₦10k = 1,000,000.
    // 2,000,000 + 1,000,000 = 3,000,000 < 5,000,000 → allow
    mockAdmin.mockReturnValue(buildClient({ tier: 1, dailyTotalKobo: 2_000_000 }));

    const result = await enforceWalletLimit('user-1', 1_000_000);
    expect(result.dailyLimitKobo).toBe(5_000_000);
  });

  it('Tier 1: throws 403 when debit would exceed ₦50k daily limit', async () => {
    mockGetKycTier.mockResolvedValue(1);
    // Daily total: ₦45k = 4,500,000 kobo. Requesting ₦10k = 1,000,000.
    // 4,500,000 + 1,000,000 = 5,500,000 > 5,000,000 → deny
    mockAdmin.mockReturnValue(buildClient({ tier: 1, dailyTotalKobo: 4_500_000 }));

    await expect(enforceWalletLimit('user-1', 1_000_000)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('Tier 1: allows debit exactly at the limit boundary', async () => {
    mockGetKycTier.mockResolvedValue(1);
    // Daily total: ₦40k. Requesting ₦10k. 4,000,000 + 1,000,000 = 5,000,000 = limit → allow
    mockAdmin.mockReturnValue(buildClient({ tier: 1, dailyTotalKobo: 4_000_000 }));

    const result = await enforceWalletLimit('user-1', 1_000_000);
    expect(result.dailyLimitKobo).toBe(5_000_000);
  });

  it('Tier 2: allows debit when under ₦200k daily limit', async () => {
    mockGetKycTier.mockResolvedValue(2);
    mockAdmin.mockReturnValue(buildClient({ tier: 2, dailyTotalKobo: 5_000_000 }));

    const result = await enforceWalletLimit('user-2', 5_000_000);
    expect(result.dailyLimitKobo).toBe(20_000_000);
  });

  it('Tier 2: throws 403 when debit would exceed ₦200k daily limit', async () => {
    mockGetKycTier.mockResolvedValue(2);
    // 19,000,000 + 2,000,000 = 21,000,000 > 20,000,000 → deny
    mockAdmin.mockReturnValue(buildClient({ tier: 2, dailyTotalKobo: 19_000_000 }));

    await expect(enforceWalletLimit('user-2', 2_000_000)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('Tier 3: returns null limit (unlimited)', async () => {
    mockGetKycTier.mockResolvedValue(3);
    mockAdmin.mockReturnValue(buildClient({ tier: 3 }));

    const result = await enforceWalletLimit('user-3', 100_000_000);
    expect(result.dailyLimitKobo).toBeNull();
  });

  it('Tier 1: new user (no ledger account yet) is allowed — daily total = 0', async () => {
    mockGetKycTier.mockResolvedValue(1);
    // acctId: null → no account row → early return with limit
    mockAdmin.mockReturnValue(buildClient({ tier: 1, acctId: null }));

    const result = await enforceWalletLimit('user-new', 1_000_000);
    expect(result.dailyLimitKobo).toBe(5_000_000);
  });
});

// ---------------------------------------------------------------------------
// enforceWalletLimit — fail closed on DB error
// ---------------------------------------------------------------------------

describe('enforceWalletLimit — fail closed on DB errors', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('throws 503 when getKycTier throws', async () => {
    mockGetKycTier.mockRejectedValue(new Error('DB connection lost'));
    mockAdmin.mockReturnValue(buildClient({ tier: 1 }));

    await expect(enforceWalletLimit('user-1', 1_000)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('throws 503 when ledger_entries query fails', async () => {
    mockGetKycTier.mockResolvedValue(1);
    mockAdmin.mockReturnValue(buildClient({ tier: 1, entriesError: true }));

    await expect(enforceWalletLimit('user-1', 1_000)).rejects.toMatchObject({
      status: 503,
    });
  });
});

// ---------------------------------------------------------------------------
// enforceVoteLimit — flag off
// ---------------------------------------------------------------------------

describe('enforceVoteLimit — FEATURE_TIER_LIMITS_ENABLED=false', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns without checking KYC or DB', async () => {
    await expect(enforceVoteLimit('user-1')).resolves.toBeUndefined();
    expect(mockGetKycTier).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enforceVoteLimit — per-tier
// ---------------------------------------------------------------------------

describe('enforceVoteLimit — tier enforcement', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('Tier 0: passes through (no paid-vote limit — existing free-vote system governs)', async () => {
    mockGetKycTier.mockResolvedValue(0);
    mockAdmin.mockReturnValue(buildClient({ tier: 0, voteCount: 999 }));

    await expect(enforceVoteLimit('user-0')).resolves.toBeUndefined();
  });

  it('Tier 1: allows vote when under 500/day limit', async () => {
    mockGetKycTier.mockResolvedValue(1);
    mockAdmin.mockReturnValue(buildClient({ tier: 1, voteCount: 499 }));

    await expect(enforceVoteLimit('user-1')).resolves.toBeUndefined();
  });

  it('Tier 1: throws 403 when daily vote count reaches 500', async () => {
    mockGetKycTier.mockResolvedValue(1);
    mockAdmin.mockReturnValue(buildClient({ tier: 1, voteCount: 500 }));

    await expect(enforceVoteLimit('user-1')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('500'),
    });
  });

  it('Tier 2: allows vote when under 2000/day limit', async () => {
    mockGetKycTier.mockResolvedValue(2);
    mockAdmin.mockReturnValue(buildClient({ tier: 2, voteCount: 1999 }));

    await expect(enforceVoteLimit('user-2')).resolves.toBeUndefined();
  });

  it('Tier 2: throws 403 when daily vote count reaches 2000', async () => {
    mockGetKycTier.mockResolvedValue(2);
    mockAdmin.mockReturnValue(buildClient({ tier: 2, voteCount: 2000 }));

    await expect(enforceVoteLimit('user-2')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('Tier 3: unlimited — never throws regardless of count', async () => {
    mockGetKycTier.mockResolvedValue(3);
    mockAdmin.mockReturnValue(buildClient({ tier: 3, voteCount: 99999 }));

    await expect(enforceVoteLimit('user-3')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceVoteLimit — fail closed on DB error
// ---------------------------------------------------------------------------

describe('enforceVoteLimit — fail closed on DB errors', () => {
  beforeEach(() => {
    vi.stubEnv('FEATURE_TIER_LIMITS_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('throws 503 when getKycTier throws', async () => {
    mockGetKycTier.mockRejectedValue(new Error('timeout'));
    mockAdmin.mockReturnValue(buildClient({ tier: 1 }));

    await expect(enforceVoteLimit('user-1')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('throws 503 when vote_transactions query fails', async () => {
    mockGetKycTier.mockResolvedValue(1);
    mockAdmin.mockReturnValue(buildClient({ tier: 1, votesError: true }));

    await expect(enforceVoteLimit('user-1')).rejects.toMatchObject({
      status: 503,
    });
  });
});
